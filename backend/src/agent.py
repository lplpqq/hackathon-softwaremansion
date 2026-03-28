"""
Forwards Fishjam audio streams with Google Gemini Live API.
"""

import asyncio
import logging
from collections.abc import Callable, Awaitable

from fishjam import FishjamClient, AgentOptions
from fishjam.integrations.gemini import GeminiIntegration
from google import genai
from google.genai.types import Blob, Modality

from src.config_reader import Settings

logger = logging.getLogger(__name__)


async def run_analysis_agent(
    settings: Settings,
    room_id: str,
    on_text: Callable[[str], Awaitable[None]],
) -> None:
    """
    audio travels from Fishjam peers → Gemini → TEXT analysis delivered via `on_text`.
    no audio is sent back into the room.

    The `on_text` callback receives incremental text chunks as they stream in
    from Gemini, so the frontend can display results in real time.
    """
    fishjam_client = FishjamClient(
        fishjam_id=settings.fishjam_id,
        management_token=settings.fishjam_management_token,
    )

    gen_ai = genai.Client(api_key=settings.google_api_key)

    # Create the agent — still needs audio settings for the *input* side
    agent_options = AgentOptions(
        output=GeminiIntegration.GEMINI_INPUT_AUDIO_SETTINGS,
    )
    agent = fishjam_client.create_agent(room_id, agent_options)

    async with agent.connect() as fishjam_session:
        # No outgoing audio track — we only send text back

        async with gen_ai.aio.live.connect(
            model=settings.gemini_model,
            config={
                "response_modalities": [Modality.AUDIO],  # this should be audio!
                "system_instruction": settings.gemini_system_instruction,
            },
        ) as gemini_session:

            async def forward_fishjam_to_gemini() -> None:
                async for track_data in fishjam_session.receive():
                    await gemini_session.send_realtime_input(
                        audio=Blob(
                            mime_type=GeminiIntegration.GEMINI_AUDIO_MIME_TYPE,
                            data=track_data.data,
                        )
                    )

            async def receive_gemini_text() -> None:
                async for msg in gemini_session.receive():
                    server_content = msg.server_content
                    if server_content is None:
                        continue

                    if (
                        server_content.model_turn
                        and server_content.model_turn.parts
                    ):
                        for part in server_content.model_turn.parts:
                            if part.text:
                                await on_text(part.text)

            logger.info("Analysis agent started for room %s", room_id)
            await asyncio.gather(
                forward_fishjam_to_gemini(),
                receive_gemini_text(),
            )
