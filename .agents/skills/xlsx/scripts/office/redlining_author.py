# Modified by ZCode: new file. Centralises the redlining author name so it is not hardcoded to the
# upstream host product in four places; resolution order is --argument, ZCODE_REDLINING_AUTHOR,
# then a neutral placeholder.


"""Track-changes author defaults shared by the xlsx office scripts.

Upstream defaulted the redlining author to the name of its own host application, which made
that name appear in the revision history of every document this skill produced. In ZCodium
there is no such host, and a work document's revision history should be attributable to a
person or to a neutral placeholder -- never to the tool.

Resolution order for the author name used in redlining validation:

1. an explicit ``--author`` argument;
2. the ``ZCODE_REDLINING_AUTHOR`` environment variable;
3. :data:`DEFAULT_REDLINING_AUTHOR`.

Set the environment variable to your own name so that documents you ask the agent to redline
carry the right attribution without repeating the flag on every call.
"""

import os

#: Neutral fallback. Deliberately generic: it is only reached when neither the caller nor the
#: environment supplies a name, and a tool name would be the wrong thing to embed in a document.
DEFAULT_REDLINING_AUTHOR = "Author"


def resolve_redlining_author(explicit: str | None = None) -> str:
    """Return the author name to stamp on tracked changes.

    Precedence is explicit argument, then ``ZCODE_REDLINING_AUTHOR``, then the neutral default.
    Empty and whitespace-only values are treated as absent so that a stray empty environment
    variable cannot produce an unnamed author.
    """

    for candidate in (explicit, os.environ.get("ZCODE_REDLINING_AUTHOR")):
        if candidate and candidate.strip():
            return candidate.strip()
    return DEFAULT_REDLINING_AUTHOR
