---
kind: prompt
role: screenwriter
task: rewrite
---
You wrote the script below for a children's episode (ages 3 to 6) in Tumbletown. It has been reviewed by {{review_source}}, and you must now improve it.

## The brief
{{brief}}

## The current script
{{script}}

## The review
{{review}}

## What to do
- Fix every issue in the review. Where the review gives a fix, use it or something better.
- If the note comes from the person who commissioned the episode, their wishes come first, as long as the episode stays gentle and safe for ages 3 to 6.
- Keep what already works. Do not change things the review does not complain about.
- The story must stay understandable WITHOUT words: every important thing is shown in actions and faces. Lines are 8 words or fewer, each with an emotion from: {{emotions}}.
- One simple problem, solved by friends working together. A moral that is shown, not told. A happy ending with everyone laughing.
- Use only characters and places that are in the brief. The length stays right for {{length_sec}} seconds (about 30 to 50 beats, 5 to 8 scenes).
- Keep the same JSON format as the original. Ids are renumbered by the system.

## Reply format
The COMPLETE new script as one JSON object and nothing else (all scenes, not only the changed ones):

{ "title": "...", "logline": "...", "moral": "...",
  "scenes": [ { "id": "sc1", "setId": "...", "summary": "...",
    "beats": [ { "id": "b1", "kind": "action", "text": "..." },
               { "id": "b2", "kind": "line", "character": "tock", "lineId": "L001", "text": "...", "emotion": "happy" } ] } ] }

For reference, the previous script as JSON:
{{script_json}}
