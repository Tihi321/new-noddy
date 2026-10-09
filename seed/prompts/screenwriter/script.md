---
kind: prompt
role: screenwriter
task: script
---
You are writing the shooting script of a children's episode (ages 3 to 6) for the Tumbletown toy-town show. A director will turn your beats into 15 to 25 camera shots, so every beat must be something that can be filmed.

## The brief
{{brief}}

## The outline to follow
{{outline}}

## The characters (use these ids)
{{cast_catalog}}

## The places (use these ids as `setId`)
{{set_catalog}}

## Episode type
{{type_guidance}}

## How the characters talk
The toys do NOT speak real words. They mumble, a bit like Pingu. The audience hears a mumble with the right tune (a question goes up, a happy line bounces) and sees what is meant. So:
- **The story must make sense with the sound off.** Everything that matters happens in ACTION beats and in faces and gestures. A line only adds colour; it never carries information that is not also visible.
- Dialogue lines are SHORT: 8 words or fewer. Simple, like "Oh no, my cap!" or "Let's help!". Use `!` and `?` so the mumble gets the right melody.
- Give every line an `emotion` from this list: {{emotions}}.
- A whole episode has about 20 to 35 lines in total, and no more than 4 lines in a row without an action beat between them.

## Structure and content
- Scene 1 starts with an establishing beat of Tumbletown (sun, birds, the town square, a bit of life). The hero appears doing something cheerful.
- Then: the one simple problem, the funny first attempts (rule of three), help from friends, a kind idea, the resolution that SHOWS the moral through what they do, and a happy ending with everyone together and laughing.
- Use only the characters and places from the brief. Each scene has ONE `setId`; start a new scene when the place changes. Plan 5 to 8 scenes and 30 to 50 beats, enough for {{length_sec}} seconds (15 to 25 shots).
- Action beats are one visible thing each, in plain words: "Tock pushes the stuck van. It does not move." "Bobbin points at the hill and jumps." Do not write camera directions or sound effects.
- Keep it gentle: soft tumbles, no crying for long, nothing scary, nobody laughs AT anyone.
- Keep actions possible for a toy figure: walking, running, hopping, turning, looking, waving, nodding, shaking the head, pointing, jumping for joy, slumping sadly, shrugging, sitting, standing, driving, picking up and giving things, gasping, laughing, sleeping, wobbling.
- Beats are renumbered by the system; give any ids you like.

## Reply format
One JSON object and nothing else. A beat of kind "action" has `id`, `kind`, `text`. A beat of kind "line" also has `character` (an id), `lineId` ("L001", "L002", ...) and `emotion`.

{ "title": "...", "logline": "...", "moral": "...",
  "scenes": [ { "id": "sc1", "setId": "town_square", "summary": "Morning in Tumbletown",
    "beats": [
      { "id": "b1", "kind": "action", "text": "The sun rises over Tumbletown. Birds sing." },
      { "id": "b2", "kind": "action", "text": "Tock drives his van into the square, waving." },
      { "id": "b3", "kind": "line", "character": "tock", "lineId": "L001", "text": "Good morning, Bobbin!", "emotion": "happy" }
    ] } ] }
