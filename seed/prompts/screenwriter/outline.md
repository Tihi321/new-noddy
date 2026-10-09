---
kind: prompt
role: screenwriter
task: outline
---
You are writing the outline of a children's episode (ages 3 to 6) for the Tumbletown toy-town show. The outline is the skeleton of the story: what happens, in order, written as things you can SEE.

## The brief
{{brief}}

## The characters
{{cast_catalog}}

## The places
{{set_catalog}}

## Episode type: how it is built
{{type_guidance}}

## The classic structure to follow
Running time {{length_sec}} seconds. Use 6 to 8 sections, with roughly these shares of the time:
1. **Cold open** (about 8 percent): an establishing view of Tumbletown, morning, birds and a friendly bit of everyday life. The hero appears doing something cheerful.
2. **The problem** (about 12 percent): the one simple problem happens, in a way a child can see.
3. **First attempts** (about 20 percent): the hero tries to fix it alone, and it goes funnily wrong (gentle slapstick: a wobble, a boing, a tumble onto something soft).
4. **Help from friends** (about 20 percent): a friend notices and comes to help. Maybe a second try goes wrong in a different funny way.
5. **The idea** (about 12 percent): someone has a kind, simple idea. It is shown with a gesture (a point, a nod, a jump).
6. **Resolution** (about 15 percent): working together, the problem is solved. The moral is shown by what they do.
7. **Happy ending** (about 13 percent): everyone is together in the town square, laughing and waving. A warm last image.

## Rules
- The story must be understandable WITHOUT words. Every important thing is an action or a face.
- One problem only. Nothing scary. No villains.
- Repeat things: young children love a rule of three (three tries) and a running gag.
- Only use the characters and places listed in the brief (characters by their ids, places by their ids). Each section's `setId` is one of the brief's locations.
- Each beat is a short plain sentence: who does what, where. No camera talk.
- `approxSec` of all sections adds up to about {{length_sec}}.

## Reply format
One JSON object and nothing else:

{ "title": "...",
  "sections": [
    { "id": "o1", "name": "Cold open", "setId": "town_square", "summary": "...",
      "beats": ["The sun rises over Tumbletown and the birds sing.", "Tock drives his van into the square and waves."],
      "approxSec": 25 }
  ] }
