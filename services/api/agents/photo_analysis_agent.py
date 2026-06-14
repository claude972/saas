"""Photo analysis sub-agent for the OpenClaw BTP cockpit.

Handles the ``analyze_photo`` intent. Given one or more site photos it asks the
LLM (vision) to describe the visible work, its condition and any points worth
attention, without inventing anything. Produces a ``photo_report`` document in
draft. When no API key is configured (LLMUnavailable) or anything fails, it
returns a clearly marked stub respecting the same format so the app stays
functional. This module is importable on its own.
"""

import base64
import os

from .base import BaseAgent
from .llm import LLMUnavailable, complete_json

SYSTEM_PROMPT = (
    "Tu es un expert technique du BTP qui analyse des photos de chantier. "
    "A partir des images fournies, decris factuellement les travaux visibles, "
    "leur etat et les points d'attention (securite, malfaçons, risques, "
    "elements manquants). N'invente RIEN : si une information n'est pas visible "
    "sur la photo, ne la deduis pas. "
    "Reponds UNIQUEMENT par un objet JSON valide de la forme : "
    '{"observations": "<synthese factuelle>", '
    '"travaux_visibles": ["<element>", ...], '
    '"points_attention": ["<point>", ...]} '
    "sans aucun texte supplementaire."
)


def _guess_media_type(path: str) -> str:
    """Return the image media type from a file extension, defaulting to JPEG."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".png":
        return "image/png"
    return "image/jpeg"


def _load_images(image_paths: list[str]) -> list[tuple[str, str]]:
    """Read image files and return ``(media_type, base64_data)`` tuples.

    Unreadable files are skipped so a single bad path never breaks the run.
    """
    images: list[tuple[str, str]] = []
    for path in image_paths:
        try:
            with open(path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            images.append((_guess_media_type(path), b64))
        except OSError:
            continue
    return images


class PhotoAnalysisAgent(BaseAgent):
    """Analyse site photos and produce a draft photo report."""

    slug = "photo_analysis_agent"
    name = "Agent Analyse Photo"
    role = "photo_analysis"
    description = (
        "Analyse les photos de chantier et redige un rapport d'observations "
        "(travaux visibles, etat, points d'attention) en brouillon."
    )
    version = "1.0.0"
    risk_level = "low"
    requires_approval = False

    async def run(self, input_data: dict) -> dict:
        """Run the photo analysis for the ``analyze_photo`` intent."""
        instruction = input_data.get("instruction", "")
        image_paths = input_data.get("image_paths") or []
        images = _load_images(image_paths)
        provider: str | None = input_data.get("provider") or None
        model: str | None = input_data.get("model") or None
        skills_text: str = str(input_data.get("skills_text") or "").strip()

        system = f"{skills_text}\n\n{SYSTEM_PROMPT}" if skills_text else SYSTEM_PROMPT

        user = (
            "Analyse les photos de chantier fournies et redige tes observations.\n"
            f"Contexte / instruction : {instruction}"
        )
        if not images:
            user += (
                "\n\nAucune image n'a pu etre chargee : appuie-toi uniquement "
                "sur le contexte ci-dessus sans rien inventer."
            )

        try:
            result = await complete_json(
                system=system,
                user=user,
                images=images or None,
                provider=provider,
                model=model,
            )
        except (LLMUnavailable, Exception):  # noqa: BLE001 - stay functional
            return self._stub(instruction, len(images))

        content = {
            "observations": result.get("observations", ""),
            "travaux_visibles": result.get("travaux_visibles", []),
            "points_attention": result.get("points_attention", []),
        }
        return {
            "document_type": "photo_report",
            "title": "Rapport d'analyse photo",
            "status": "draft",
            "content": content,
        }

    def _stub(self, instruction: str, image_count: int) -> dict:
        """Return a clearly marked stub respecting the expected format."""
        return {
            "stub": True,
            "document_type": "photo_report",
            "title": "Rapport d'analyse photo (stub)",
            "status": "draft",
            "content": {
                "observations": (
                    "Analyse indisponible (LLM non configure). "
                    f"Instruction recue : {instruction or 'aucune'}. "
                    f"Images recues : {image_count}."
                ),
                "travaux_visibles": [],
                "points_attention": [
                    "Resultat genere en mode stub : aucune analyse reelle effectuee."
                ],
            },
        }
