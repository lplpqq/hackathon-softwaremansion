"""
Gemini Live API transcribes audio in real time (input_audio_transcription)
We chunk the transcript by WORD COUNT (not punctuation)
Every ~5-8 words we fire a generate_content call for instant fact-check
Complete JSON result is pushed to the frontend immediately
Multiple analyses can run in parallel for overlapping speed
"""

import asyncio
import json
import logging
import traceback
from collections.abc import Callable, Awaitable

from fishjam import FishjamClient, AgentOptions
from fishjam.integrations.gemini import GeminiIntegration
from google import genai
from google.genai import types

from src.config_reader import Settings

logger = logging.getLogger(__name__)

# ── Tuning ────────────────────────────────────────────────────────────────

# Fire analysis every N words
WORDS_PER_CHUNK = 10

# Also fire if buffer sits idle for this many seconds (catches trailing words)
IDLE_FLUSH_SECONDS = 2.5

# Max parallel analysis calls
MAX_CONCURRENT = 4




async def run_analysis_agent(
    settings: Settings,
    fishjam_client: FishjamClient,
    gen_ai: genai.Client,
    room_id: str,
    on_text: Callable[[str], Awaitable[None]],
) -> None:

    agent_options = AgentOptions(
        output=GeminiIntegration.GEMINI_INPUT_AUDIO_SETTINGS,
    )
    agent = fishjam_client.create_agent(room_id, agent_options)

    async with agent.connect() as fishjam_session:

        live_config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(
                parts=[types.Part(text=settings.prompts["transcribe_audio"])]
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
        )

        logger.info("Connecting Gemini Live model=%s room=%s", settings.gemini_model, room_id)

        async with gen_ai.aio.live.connect(
            model=settings.gemini_model,
            config=live_config,
        ) as gemini_session:

            audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
            chunk_queue: asyncio.Queue[str] = asyncio.Queue()
            semaphore = asyncio.Semaphore(MAX_CONCURRENT)
            stop = asyncio.Event()

            # word buffer — shared between receive task and flusher
            words: list[str] = []
            words_lock = asyncio.Lock()
            last_word_time: float = 0.0

            # fishjam to queue
            async def fishjam_to_queue():
                try:
                    async for td in fishjam_session.receive():
                        await audio_queue.put(td.data)
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error("fishjam_to_queue: %s", e)

            # queue → Gemini Live
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_queue.get()
                        await gemini_session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type=GeminiIntegration.GEMINI_AUDIO_MIME_TYPE,
                            )
                        )
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error("send_audio: %s", e)

            async def receive_transcript():
                nonlocal last_word_time
                try:
                    while True:
                        async for resp in gemini_session.receive():
                            sc = resp.server_content
                            if sc is None:
                                continue
                            if sc.input_transcription and sc.input_transcription.text:
                                fragment = sc.input_transcription.text
                                new_words = fragment.split()
                                if not new_words:
                                    continue

                                async with words_lock:
                                    words.extend(new_words)
                                    last_word_time = asyncio.get_event_loop().time()

                                    # fire when we hit the word threshold
                                    while len(words) >= WORDS_PER_CHUNK:
                                        chunk_text = " ".join(words[:WORDS_PER_CHUNK])
                                        del words[:WORDS_PER_CHUNK]
                                        await chunk_queue.put(chunk_text)

                        logger.debug("Live receive ended, re-entering")
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error("receive_transcript: %s\n%s", e, traceback.format_exc())
                finally:
                    stop.set()

            # flush leftover words on silence
            async def idle_flusher():
                nonlocal last_word_time
                try:
                    while not stop.is_set():
                        await asyncio.sleep(0.5)
                        now = asyncio.get_event_loop().time()
                        async with words_lock:
                            if words and (now - last_word_time) >= IDLE_FLUSH_SECONDS:
                                chunk_text = " ".join(words)
                                words.clear()
                                await chunk_queue.put(chunk_text)
                except asyncio.CancelledError:
                    pass

            # ── Consume chunks → fire parallel analyses ───────────────────
            async def analyzer():
                try:
                    while not stop.is_set():
                        try:
                            text = await asyncio.wait_for(chunk_queue.get(), timeout=1.0)
                        except asyncio.TimeoutError:
                            continue
                        asyncio.create_task(_analyze(settings, text, gen_ai, semaphore, on_text))
                except asyncio.CancelledError:
                    pass

            tasks = [
                asyncio.create_task(fishjam_to_queue()),
                asyncio.create_task(send_audio()),
                asyncio.create_task(receive_transcript()),
                asyncio.create_task(idle_flusher()),
                asyncio.create_task(analyzer()),
            ]

            logger.info("Lie detector running for room %s", room_id)
            try:
                await stop.wait()
            finally:
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                logger.info("Agent stopped for room %s", room_id)


async def _analyze(
    settings: Settings,
    text: str,
    gen_ai: genai.Client,
    semaphore: asyncio.Semaphore,
    on_text: Callable[[str], Awaitable[None]],
):
    """Fact-check a single chunk and push JSON to frontend."""
    async with semaphore:
        try:
            analysis_prompt = settings.prompts["agent_analysis_prompt"]
            resp = await gen_ai.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=f'{analysis_prompt}"{text}"',
                config={"temperature": 0.1},
            )

            raw = (resp.text or "").strip()
            if raw.startswith("```"):
                lines = raw.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                raw = "\n".join(lines).strip()

            parsed = json.loads(raw)
            parsed["transcript"] = text

            verdict = parsed.get("verdict", "").upper()
            parsed["alarm"] = verdict in ("FALSE", "MISLEADING")

            await on_text(json.dumps(parsed))

            if parsed["alarm"]:
                logger.warning("🚨 ALARM: \"%s\" → %s", text, parsed.get("explanation", ""))

        except json.JSONDecodeError:
            await on_text(json.dumps({
                "verdict": "ERROR",
                "confidence": 0,
                "explanation": "Parse error",
                "claim": text,
                "transcript": text,
                "alarm": False,
            }))
        except Exception as e:
            logger.error("_analyze failed: %s", e)