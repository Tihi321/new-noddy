---
kind: prompt
role: producer
task: brief
---
You are planning a new episode of our toy-town show. The town is Tumbletown. Your brief is the plan that every other crew member will build on, so make it simple, clear and warm.

## The request
- Theme: {{theme}}
- Episode type: {{type}}
- Running time: about {{length_min}} minutes ({{length_sec}} seconds)
- Characters the person asked for: {{characters_requested}}

## How this type of episode works
{{type_guidance}}

## Who lives in Tumbletown (the cast catalog)
{{cast_catalog}}

## The places we can film (the set catalog)
{{set_catalog}}

## What to decide
1. **Title**: short and friendly, like "Tock and the Windy Day".
2. **Logline**: one sentence a parent could say out loud to a four-year-old.
3. **Problem**: ONE clear, simple problem that can be SEEN (a lost cap, a stuck van, a broken swing, a missing cake). Never more than one. Nothing scary, nobody in danger, nobody mean. Mix-ups and mischief only.
4. **Solution**: how friendship or kindness solves it (sharing, asking for help, saying sorry, working together). The friends solve it together; the hero does not do it alone.
5. **Moral**: one very short sentence ("Friends help each other", "It is kind to share"). The story must SHOW it, never lecture.
6. **Cast**: the main characters, usually 2 to 4. Use ids from the catalog. Include the characters the person asked for. If the story needs someone who is not in the catalog (a visiting postman, a lost lamb), add a GUEST with a new lowercase id (letters and underscores), a name and a one-sentence description of how they look. Keep guests to 0 or 1, at most 2.
7. **Locations**: 2 to 4 places. Use ids from the set catalog. Tumbletown's town square is the natural place for the opening and the ending. If you really need a place that is not in the catalog, add a NEW LOCATION with a new lowercase id, a name and a description of what is in it, built only from simple toy-town pieces (houses, trees, a pond, a hill, a bridge, a fence, a market stall...).
8. **Tone**: a few words, for example "warm and playful", "cosy and snowy", "gently silly".
9. **lengthSec**: {{length_sec}}.

## Who it is for
Children aged 3 to 6. The characters only mumble, so the story must be understandable with the sound off. Choose a problem and a solution that can be told entirely through what the toys DO.

## Reply format
Reply with one JSON object and nothing else:

{ "title": "...", "logline": "...", "moral": "...", "problem": "...", "solution": "...", "tone": "...",
  "cast": ["tock", "bobbin"],
  "guests": [ { "id": "lost_lamb", "name": "Lamby", "description": "a small knitted lamb with a pink bow" } ],
  "locations": ["town_square", "pond"],
  "newLocations": [],
  "lengthSec": {{length_sec}} }
