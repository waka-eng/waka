PRD: Inspiration & Context Engine

Must-use tech: Neon for Database, google social login for auth

1. Overview & Problem Statement
The modern thinker encounters inspiration daily—in terminal conversations with AI, coffee chats, articles, and videos. Yet, these inspirations are fleeting. They live in siloed notes apps or get lost in the noise. Furthermore, when users need to articulate their goals (e.g., in a hackathon application or a LinkedIn outreach), they often rely on generic LLM outputs that lack their authentic voice and underlying beliefs.
This product is a ubiquitous capture and synthesis engine. It seamlessly ingests inspiration, automatically clusters related thoughts over time, connects users with similar "top of minds" for serendipitous discussions (잡소리 sessions), and transforms this personal knowledge graph into context-aware, authentic output anywhere the user's cursor rests.
2. Product Goals & Core Value Proposition
Frictionless Capture: Reduce the time from "inspired thought" to "saved context" to zero, across all surfaces (CLI, Mobile, Web).
Adaptive Reflection: Intelligently discern when to silently save a note versus when to engage the user in a deeper reflection on why they were inspired.
The "Wow" Moment: 
Surprise users by autonomously surfacing connections between a thought they had today and an inspiration they saved a year ago.
Surprise users by surfacing connections between thoughts that 
Action
Form Environments of Ambition (Social): Connect users whose inspiration clusters overlap, naturally cultivating an environment that sets a new bar for ambition and risk-taking among peers.
Other Actions: ex Challenges

3. Core Features & User Journeys
3.1. The Capture Layer (Ubiquitous Input)
The product must meet the user exactly where the inspiration occurs.
CLI Integration: A simple command to instantly summarize and store the context of a terminal-based CLI conversation.
On-the-Go "Raw" Capture: A mobile-optimized interface for text, voice, photo, video immediately following a conference or coffee chat.
Universal Web Clipper: One-click saving for URLs, screenshots, videos, and blogs.
3.2. Adaptive Reflection Flow
Not all saves require the same level of friction. The system will use contextual clues (device type, time of day, input speed) to manage the saving flow:
Quick Save (Pass-through): For links and rapid notes. "Got it. Saved."
Guided Reflection: If the system detects a highly nuanced idea, it gently prompts: "This is interesting. What exactly sparked your thought here?" The user can engage.
3.3. The Synthesis Engine (Clustering)
This is the core "aha!" mechanic of the product.
Semantic Connecting: The backend maps new entries against the user's historical data upon new inspiration being added.
Surprise Resurfacing: When a new note is added, the system actively links it to past inspirations, showing the evolution of a thought. (e.g., "This ties perfectly into the video you saved last October about AI interpretability.") Discovers new connections
3.4. Shareable Context Generator
Shareable card / link of my inspirations

4. User Experience (UX) Principles
Invisible until needed: The tool should not feel like another "chore" app. The UI should be minimal, focusing purely on input
Trust through authenticity: The generative outputs must clearly reflect the user's past inputs. If the AI hallucinates preferences, trust is instantly broken.
Delight in serendipity: The social matches and the auto-clustering should feel like magic, revealing patterns the user didn't consciously realize they had.