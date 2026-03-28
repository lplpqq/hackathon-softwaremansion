"""
Agent module — bridges Fishjam audio streams with Google Gemini Live API.

Uses the same queue + event-loop architecture as the reference GeminiLive class:
- Fishjam audio is fed into an asyncio.Queue
- Gemini receives from that queue and streams responses
- input_transcription  → what the user said  → forwarded via on_text
- output_transcription → Gemini's analysis   → forwarded via on_text
- No audio is sent back into the Fishjam room
"""

import asyncio
import logging
import traceback
from collections.abc import Callable, Awaitable

from google import genai
from google.genai import types

from fishjam import FishjamClient, AgentOptions
from fishjam.integrations.gemini import GeminiIntegration

from src.config_reader import Settings

logger = logging.getLogger(__name__)


async def run_analysis_agent(
    settings: Settings,
    fishjam_client: FishjamClient,
    gen_ai: genai.Client,
    room_id: str,
    on_text: Callable[[str], Awaitable[None]],
) -> None:
    """
    Audio from Fishjam peers → Gemini → text analysis delivered via on_text.

    No audio is sent back into the room. Gemini must use AUDIO response
    modality (required by native-audio models), but we discard the audio
    and only use the transcription side-channels.
    """

    # -- Fishjam agent setup (input side: 16 kHz to match Gemini) -----------
    agent_options = AgentOptions(
        output=GeminiIntegration.GEMINI_INPUT_AUDIO_SETTINGS,
    )
    agent = fishjam_client.create_agent(room_id, agent_options)

    async with agent.connect() as fishjam_session:

        # -- Gemini session config ------------------------------------------
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(
                parts=[types.Part(
                    text="You are professional lie/manipulation detector. "
                         "I am watching a video right now, which I would like you to analyze for potential misleadings of me. "
                         "I would like you to provide your assessment based on how factual the information is being said. "
                         "You can here the video audio that I am watching right now. "
                         "As a response I expect to receive a JSON string with next fields: is_factual_information - a boolean value (true or false) of whether the information being said/shown is true or not; short_text_analysis is a short summary of the data provided in the video"
                )]
            ),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )

        logger.info("Connecting to Gemini Live model=%s for room=%s", settings.gemini_model, room_id)

        async with gen_ai.aio.live.connect(
            model=settings.gemini_model,
            config=config,
        ) as gemini_session:

            # -- Queue: Fishjam audio → Gemini ------------------------------
            audio_input_queue: asyncio.Queue[bytes] = asyncio.Queue()

            async def fishjam_to_queue() -> None:
                """Read audio from Fishjam peers and enqueue it."""
                try:
                    async for track_data in fishjam_session.receive():
                        await audio_input_queue.put(track_data.data)
                except asyncio.CancelledError:
                    logger.debug("fishjam_to_queue cancelled")
                except Exception as e:
                    logger.error("fishjam_to_queue error: %s\n%s", e, traceback.format_exc())

            async def send_audio() -> None:
                """Drain the queue and forward chunks to Gemini."""
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await gemini_session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type=GeminiIntegration.GEMINI_AUDIO_MIME_TYPE,
                            )
                        )
                except asyncio.CancelledError:
                    logger.debug("send_audio cancelled")
                except Exception as e:
                    logger.error("send_audio error: %s\n%s", e, traceback.format_exc())

            # -- Event queue: Gemini responses → on_text --------------------
            event_queue: asyncio.Queue[dict | None] = asyncio.Queue()

            async def receive_loop() -> None:
                """
                Consume Gemini responses, extract transcriptions, and
                push events onto the event queue.
                Audio inline_data is intentionally discarded.
                """
                try:
                    while True:
                        async for response in gemini_session.receive():
                            server_content = response.server_content

                            if response.go_away:
                                logger.warning("Gemini GoAway: %s", response.go_away)

                            if server_content is None:
                                continue

                            # What the USER said (input transcription)
                            if (
                                server_content.input_transcription
                                and server_content.input_transcription.text
                            ):
                                await event_queue.put({
                                    "type": "user",
                                    "text": server_content.input_transcription.text,
                                })

                            # What GEMINI said back (output transcription)
                            if (
                                server_content.output_transcription
                                and server_content.output_transcription.text
                            ):
                                await event_queue.put({
                                    "type": "gemini",
                                    "text": server_content.output_transcription.text,
                                })

                            if server_content.turn_complete:
                                await event_queue.put({"type": "turn_complete"})

                            if server_content.interrupted:
                                await event_queue.put({"type": "interrupted"})

                            # We intentionally ignore model_turn audio
                            # (inline_data) — we only want text.

                        # receive() iterator ended (e.g. after turn_complete),
                        # re-enter to keep listening for the next turn
                        logger.debug("Gemini receive iterator completed, re-entering")

                except asyncio.CancelledError:
                    logger.debug("receive_loop cancelled")
                except Exception as e:
                    logger.error("receive_loop error: %s\n%s", e, traceback.format_exc())
                    await event_queue.put({"type": "error", "error": str(e)})
                finally:
                    logger.info("receive_loop exiting")
                    await event_queue.put(None)  # sentinel to stop event consumer

            # -- Start all tasks --------------------------------------------
            fishjam_task = asyncio.create_task(fishjam_to_queue(), name="fishjam_to_queue")
            send_task = asyncio.create_task(send_audio(), name="send_audio")
            recv_task = asyncio.create_task(receive_loop(), name="receive_loop")

            logger.info("Analysis agent running for room %s", room_id)

            try:
                # Consume the event queue and forward text to the caller
                while True:
                    event = await event_queue.get()

                    if event is None:
                        # Sentinel — receive_loop exited
                        break

                    if event["type"] == "error":
                        logger.error("Gemini error event: %s", event["error"])
                        break

                    # if event["type"] == "user":
                    #     await on_text(f"[User]: {event['text']}")

                    elif event["type"] == "gemini":
                        print(event["text"])
                        await on_text(event['text'])

                    elif event["type"] == "turn_complete":
                        await on_text("\n")

                    # elif event["type"] == "interrupted":
                    #     await on_text("[interrupted]\n")

            finally:
                logger.info("Cleaning up agent tasks for room %s", room_id)
                fishjam_task.cancel()
                send_task.cancel()
                recv_task.cancel()
                # Wait for tasks to actually finish
                await asyncio.gather(
                    fishjam_task, send_task, recv_task,
                    return_exceptions=True,
                )
                logger.info("Agent fully stopped for room %s", room_id)