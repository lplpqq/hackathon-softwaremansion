import asyncio
import logging
import uuid
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.genai.types import GenerateContentConfigOrDict
from pydantic import BaseModel, Field

from fishjam import FishjamClient, PeerOptions, AgentOptions
from fishjam.integrations.gemini import GeminiIntegration

from .config_reader import Settings
from .agent import run_analysis_agent

logger = logging.getLogger(__name__)


class Session:
    """Tracks a running session (room + peer + agent task)."""

    def __init__(
        self,
        session_id: str,
        room_id: str,
        peer_token: str,
    ):
        self.session_id = session_id
        self.room_id = room_id
        self.peer_token = peer_token
        self.agent_task: Optional[asyncio.Task] = None
        self.websockets: list[WebSocket] = []

    async def broadcast_text(self, text: str) -> None:
        """Send a text chunk to all connected WebSocket clients."""
        dead: list[WebSocket] = []
        for ws in self.websockets:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.websockets.remove(ws)


_sessions: dict[str, Session] = {}

def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Audio Analyzer Backend")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    fishjam_client = FishjamClient(
        fishjam_id=settings.fishjam_id,
        management_token=settings.fishjam_management_token,
    )

    class CreateSessionResponse(BaseModel):
        session_id: str
        room_id: str
        peer_token: str
        ws_url: str


    # create room, peer, and start agent

    @app.post("/session", response_model=CreateSessionResponse)
    async def create_session():
        session_id = uuid.uuid4().hex[:12]

        # 1. Create a Fishjam room
        room = fishjam_client.create_room()
        logger.info("Created room %s", room.id)

        # 2. Create a peer for the Electron client
        peer, peer_token = fishjam_client.create_peer(
            room.id,
            options=PeerOptions(metadata={"role": "electron-client"}),
        )
        logger.info("Created peer %s in room %s", peer.id, room.id)

        # 3. Build the session object
        session = Session(
            session_id=session_id,
            room_id=room.id,
            peer_token=peer_token,
        )
        _sessions[session_id] = session

        # 4. Start the agent as a background task
        async def on_text(text: str) -> None:
            await session.broadcast_text(text)

        coro = run_analysis_agent(settings, room.id, on_text=on_text)

        session.agent_task = asyncio.create_task(
            coro, name=f"agent-{session_id}"
        )

        # Fire-and-forget error logging
        def _handle_agent_done(task: asyncio.Task) -> None:
            if task.cancelled():
                logger.info("Agent task %s cancelled", session_id)
            elif task.exception():
                logger.error(
                    "Agent task %s failed: %s",
                    session_id,
                    task.exception(),
                )

        session.agent_task.add_done_callback(_handle_agent_done)

        ws_url = f"/ws/analysis/{session_id}"
        return CreateSessionResponse(
            session_id=session_id,
            room_id=room.id,
            peer_token=peer_token,
            ws_url=ws_url,
        )

    # stream text analysis to frontend

    @app.websocket("/ws/analysis/{session_id}")
    async def analysis_websocket(websocket: WebSocket, session_id: str):
        session = _sessions.get(session_id)
        if not session:
            await websocket.close(code=404, reason="Session not found")
            return

        await websocket.accept()
        session.websockets.append(websocket)
        logger.info("WebSocket client connected to session %s", session_id)

        try:
            # Keep the connection alive; the agent pushes text via broadcast
            while True:
                # We can also receive messages from the frontend if needed
                # (e.g., commands to change analysis mode)
                data = await websocket.receive_text()
                logger.debug("Received from frontend: %s", data)
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected from session %s", session_id)
        finally:
            if websocket in session.websockets:
                session.websockets.remove(websocket)

    @app.delete("/session/{session_id}")
    async def delete_session(session_id: str):
        session = _sessions.pop(session_id, None)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Cancel the agent background task
        if session.agent_task and not session.agent_task.done():
            session.agent_task.cancel()

        # Close all WebSocket connections
        for ws in session.websockets:
            try:
                await ws.close()
            except Exception:
                pass

        logger.info("Session %s deleted", session_id)
        return {"status": "ok"}


    class CheckArticleRequest(BaseModel):
        url: str

    class CheckArticleChunk(BaseModel):
        quote: str
        explanation: str

    class CheckArticleResponse(BaseModel):
        source_credibility_score: float
        publisher_description: str
        short_text_analysis: str
        potential_manipulation_text_chunks: list[CheckArticleChunk]

    @app.post("/check-article", response_model=CheckArticleResponse)
    async def ask_gemini(body: CheckArticleRequest):
        from google import genai

        # article_data = get_article_data()
        # {
        #     "source": "...",
        #     "author": "...",
        #     "text": "..."
        # } 

        article_data = {
            "source": "bbc",
            "author": "Anthony Zurcher",
            "text": "A majority of the American public, polls suggest, have been against the ongoing US-Israeli military campaign in Iran from the day it started. Republicans, however, have largely stuck by their president as the war approaches the end of its fourth week. But that may be changing. At the annual Conservative Political Action Conference (CPAC) in Texas, some of the party faithful expressed concern about why the US started this war, how Donald Trump is going to end it and whether the effort has been worth the costs. \"I just wish that there was more transparency on why we're doing what we're doing, that way you could send your loved one overseas and be OK with that,\" said Samantha Cassell. \"I hope it comes to an end quick, because it's the cost of living, the oil and gas, the prices are only going to keep going up.\" Cassell, who lives in Dallas, and her friend Joe Bolick were attending their first CPAC conference. He also had his doubts about the war. \"I don't see an endgame yet,\" he said. \"What are we actually trying to achieve? Is it true regime change? What does that look like? Who to replace them? I think we kind of got ourselves stuck.\" CPAC has been welcoming ground for Trump for a decade, shifting from a libertarian-leaning gathering to one dominated by Make America Great Again loyalists. The conservative conference has traditionally been held just outside Washington DC, but this year it moved to a sprawling hotel complex near Dallas, Texas. The atmosphere at this year's conference was similar to the past. A cavernous main auditorium offered days full of panels and speakers. A floor below, the exhibit hall featured plenty of conservative kitsch – a bus with the president's face on it, Trump 2028 T-shirts and glasses commemorating the 2024 attempted assassination of Trump with \"bulletproof\" written on it and a faux bullet embedded in its side. US envoy 'hopeful' for meetings with Iran 'this week', as Tehran says Israel hit nuclear sites Three charts that are warning signs flashing for Trump on Iran war Why is it so hard to pass through the Strait of Hormuz? Some things were different, however. Even more than a thousand miles from Washington DC, the war in Iran was a common topic of conversation. And if there has been a recurring theme among the dozens of people interviewed by the BBC, it is that the conflict is creating a generational divide within conservative ranks. Toby Blair, a 19-year-old college student at the University of South Florida, travelled to Dallas for CPAC with his friend Shashank Yalamanchi, a first-year law student. Neither said that they believed the Iran war was in America's best interests. \"I don't like that it's become America's job to find bad people and get rid of them,\" he said. \"Especially when you have so many people at home that can't afford basic things like groceries and gas.\" Yalamanchi said that many young conservatives supported Trump because he promised to avoid getting tangled in overseas wars – that he was a realist when it came to foreign policy, not an interventionist. Two US Marine amphibious units are currently deploying to the Gulf. Elements of a US paratrooper division are also reportedly on their way. The Pentagon is also considering a $200bn request for war funding. All of this amounts to the prospect that, despite the president's assurances, the Iranian conflict may not end anytime soon. \"We have a lot of issues domestically that we need to handle, and when we're spending our time and effort justifying and fighting a foreign war, we have less time and effort to spend changing things here at home,\" he said. 1:19 Watch: 'Affordability is the biggest thing' - Conservatives mixed on economy under Trump The members of the \"Trump Tribe of Texas\" – wearing matching gold sequined jackets and necklaces spelling out the president's name – were an older crowd. Its founder, Michael Manuel-Reaud, was attending his sixth CPAC and said Iran posed a danger that needed to be dealt with. \"If there's a threat for the United States getting bombed with a nuclear bomb, who can say no to that?\" he asked. \"[Trump] can't just quit. He's not going to stop until he finishes.\" The rest of the tribe agreed. \"I trust Trump to know what he's doing,\" said Penny Crosby. \"I just think whatever Trump believes needs to happen, needs to happen to take care of the job. \"He's protecting us, protecting the American people,\" Blake Zummo said. \"They're coming for us.\" If conference-goers here have been split over the war, on Thursday they were largely drowned out by vocal group of Iranian-Americans who have been boisterously celebrating the US military operation. They chanted \"Thank you Trump\" during a morning panel featuring two women that had been injured in anti-regime protests in Iran. They filled the hallways with shouts of \"regime change for Iran\" while holding photographs of Reza Pahlavi, the son of the late Shah of Iran, who was deposed following the nation's 1979 Islamic revolution. In the afternoon, the activists rallied outside the conference centre, waving Iranian lion-and-sun flags from the Shah's time as monarch. \"It's just so refreshing to see... the people of Iran finally having a shot at liberation after 47 years of oppression and tyranny under the Islamic regime,\" said Nima Poursohi, who was sporting a \"Persians for Trump\" T-shirt and a \"Make America Great Again\" hat with \"Persian Excursion\" embroidered on the side. \"No other president dealt with Iran or had even the courage to take a step forward like President Trump has,\" she said. The outpouring of emotion of Iranian-Americans at CPAC didn't surprise Matt Schlapp, the event's organiser. \"If you were deprived of freedom for a generation, you probably want to be pretty excited to get it back,\" he told the BBC. But he said there was \"no guarantee\" that would happen. Schlapp, president of the American Conservative Union, has been running CPAC for 12 years. And he noted that – Iranian activists aside – there was a debate over where the war goes from here. \"Conservatives trust President Trump,\" he said. \"They give him a lot of latitude. But behind that is some concern about where this goes.\" That concern wasn't just expressed among the rank-and-file at the conference. It also spilled out onto the conferences main stage. On Thursday afternoon, former Congressman Matt Gaetz warned that, with thousands of new US soldiers heading to the Middle East, a ground invasion of Iran would make the US \"poorer and less safe\". \"It will mean higher gas prices higher food prices,\" he said, \"and I'm not sure we would end up killing more terrorists than we would create.\" Getty Images Matt Gaetz delivers remarks at a podium, looking to the right of the picture. He has his right arm outstretched and wears a dark blue suit and white shirt. He appears to be on stage under strong spotlights.Getty Images Former Congressman Matt Gaetz warned that a ground invasion of Iran would make the US \"poorer and less safe\" The next day, on a panel that was titled \"Breaking Stuff and Killing Bad Guys: The Case for Western Military Dominance\", Erik Prince, founder of the military contractor Blackwater, painted a dark picture about the future of the war and dismissed the administration's \"optimism\" about a rapid, peaceful end to the fighting. \"We face an extremely difficult challenge,\" he said. \"Iran doesn't have an independence day because they have not been conquered since the days of Alexander the Great.\" When former Navy Seal Jason Redman, also on the panel, said that America had to finish the job in Iran, some in the crowd cheered and chanted \"USA\". At the end of the panel, Prince offered a word of caution. \"I agree, USA all the way,\" be said, \"but all the people who are cheering, make sure you put skin in the game.\" That elicited a round of applause from others in the crowd. Getty Images Man wearing TRUMP 2028 red hat with a '250th' badge on the top in colours of the USA flagGetty Images Recent polling by Pew Research sheds light on some of these cracks that have appeared in Trump's formerly rock solid political base. While 79% of Republicans approve of how the president is handling the war, only 49% strongly approve. That number drops to 22% among those who \"lean\" Republican. The age gap is also visible in Pew's results. While 84% of Republicans say they back Trump's war conduct, only 49% of those ages 18 to 29 feel that way. Jim McLaughlin, Trump's longtime pollster, said that surveys overstate the divisions among conservatives – and that any friction within Trump's movement is temporary. \"It's only going to be a matter of time before we go back to $2 gas again. This is not going to be long and drawn out,\" he said. \"We're having a little bit of a blip here with the Iran military operation, but once that's over, you're going to see prices go down again significantly.\" Time will tell, but for the moment it may be setting off alarms for Trump and Republicans looking ahead to November's crucial midterm congressional elections. Younger voters were a key part of the coalition that delivered the White House back to Trump in 2024. And even 80% overall support from Republicans, while still a high mark, could spell trouble if it is tepid and translates into lower enthusiasm – and lower turnout – during upcoming congressional campaigns. Trump recently said that the US war in Iran is \"winding down\". On Friday night, he said he believed his base would stick with him because they don't want Iran to have nuclear weapons and they liked America protecting \"certain allies\" - such as Israel and the Arab Gulf states. But wars have a way of evolving in unexpected ways, and the Iranian regime, Israel and America's Arab allies will have a say in events to come. But this CPAC conference hints that the pressure for the president to find an off-ramp from the conflict is starting to build. \"You have to be convinced that this is the right thing to do, particularly now that we are on the eve, potentially, of the insertion of American combat troops,\" former White House adviser Steve Bannon told the CPAC audience on Friday. \"This is a debate that has to happen."
        }


        client = genai.Client(api_key=settings.google_api_key)
        system_instruction = "You are professional lie/manipulation detector. I found an online article, which I would like you to analyze for potential user misleadings. I would like you to provide your assessment of this article based on its truthfullness and trustworthiness. The input is as follows. Firstly, source - the website where this article was published (e.g. bbc, cnbc). You need to evaluate how well-known and reputable this website is. Secondly, author - the person who wrote the report. You need to find the brief information about this person. Lastly, text - the actual content of the story. You  must evaluate the truthfulness of this article primarly based on it. As a response I expect to receive a JSON string with next fields: source_credibility_score - a float from 0 to 1 of how reputable the `source` website is; author_description - a laconic, 1 sentence description of who the author of this article is and whether he/she is worth of trust; short_text_analysis - the brief summary (3-4 sentences) of how manipulative/emotionfull/provoking the text is; potential_manipulation_text_chunks - list of exact pieces of text from original article which are the most emotion-invoking/provocative/baitfull. The format of potential_manipulation_text_chunks is `quote` - the precise, 1-to-1 quote from the original text (no more than 2 sentences per chunk), `explanation` - your explanation of why is this `quote` dangerous!"
        system_instruction += f"\nFull article text: {article_data['text']}\n Source: {article_data['source']}\n Author: {article_data['author']}"



        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=body.model_dump_json(),
                config={
                    "system_instruction": system_instruction,
                    "temperature": 0.3
                }
                # config=GenerateContentConfigOrDict(
                #     system_instruction=system_instruction,
                #     temperature=0.3
                # )
            )
            print(response.text)

            return CheckArticleResponse(source_credibility_score=0.1, publisher_description="hey")
        except Exception as e:
            logger.error("Gemini text query failed: %s", e)
            raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

    return app

    return app

