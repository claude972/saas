# Audit design — cockpit + documents (mode: audit design)

> Lecture seule, aucune modification. Portée : les deux surfaces vues par des
> humains — les **PDF client** (devis + comptes rendus, 4 marques) et l'**UI du
> cockpit**. Audit fondé sur le code + les aperçus (`design/apercu-*.html`).
> **Non fait** (pas d'accès authentifié) : QA visuelle multi-breakpoint de l'app
> en direct → à réaliser (voir P2-7).

Sévérité : **P1** = à corriger, **P2** = recommandé, **P3** = polish.

---

## A. Documents PDF (sortie client — enjeu image de marque fort)

**Solide** : trame A4 unique et cohérente, hiérarchie claire (en-tête noir →
strip → parties → sections), `print-color-adjust:exact`, chiffres tabulaires,
accent + logo par société, émojis retirés, photos portrait nettes.

| # | Sévérité | Constat | Recommandation |
|---|---|---|---|
| A-1 | **P1** | **Deux bleus quasi identiques** : Suivisio `#1184CC` et Brume `#0E80D0`. Indistinguables côté client, fragilise le système de marques. | Écarter les teintes (Brume plus cyan/clair, ou Suivisio plus foncé) ou différencier par un 2e signal (typo/pictogramme). |
| A-2 | **P1** | **Logo CED incohérent** : l'export utilise le sigle « double crochet » (`14.png`), alors que ta maquette de compte rendu montrait le lockup « CED / Caraïbes Électricité Domotique ». Deux identités CED coexistent. | Choisir **un** logo CED de référence et l'utiliser partout (devis + CR). |
| A-3 | **P2** | **Tailles de logo non systématiques** : Brume en-tête 92px vs 68px pour les autres ; émetteur 64 vs 46. Rupture d'un « système ». | Définir une échelle unique (ex. hauteur cible identique, à ratio compensé) plutôt qu'un px par marque. |
| A-4 | **P2** | **Deux systèmes typographiques** : PDF en Inter + JetBrains Mono, cockpit en Saira + IBM Plex. Le client et l'utilisateur voient deux « voix ». | Aligner (au moins le mono) ou assumer explicitement PDF ≠ app. |
| A-5 | **P2** | **Compte rendu — vue lecture** : hors édition, l'intervention s'affiche en **JSON brut** (`JsonContent`) dans le cockpit. Incohérent avec la qualité du PDF. | Ajouter un rendu lecture dédié (ou intégrer l'aperçu PDF). |
| A-6 | **P3** | Photos data-URI empilées (3 × portrait 112mm) → le CR peut faire 2-3 pages. Acceptable, mais pas de contrôle de coupe page. | `break-inside:avoid` sur chaque bloc photo. |
| A-7 | **P3** | Accent « # » de l'en-tête, très petit sur fond noir pour les teintes foncées. | Vérifier le ratio de contraste des accents foncés sur noir. |

---

## B. UI cockpit (outil interne, thème sombre unique)

**Solide** : design system tokenisé (oklch), couleurs sémantiques cohérentes,
composants réutilisés (Panel, cards, FilterTabs, modales), états
loading/empty/error présents, accent ambre discipliné.

| # | Sévérité | Constat | Recommandation |
|---|---|---|---|
| B-1 | **P1** | **ExportBar surchargée** : jusqu'à **8 boutons pairs** (PDF OM2, Word, Excel, Obat, CED, Suivisio, Brume, Email) qui wrappent. Charge visuelle + hiérarchie plate. | Regrouper les **variantes PDF de marque** dans **un seul menu** « Exporter ▾ » ; garder Email en action distincte. |
| B-2 | **P1** | **Contraste / petites tailles** : `--text-3` (oklch .535) sur `--bg` (.175) pour des `micro` labels de 10.5px → sous le seuil AA probable. | Remonter le texte tertiaire ou la taille des micro-labels ; vérifier AA. |
| B-3 | **P2** | **Accessibilité upload photos** (`InterventionEditor`) : input `opacity:0` sur un `<label>`. Focus clavier / lecteur d'écran à vérifier ; pas d'état focus visible sur la zone. | Ajouter un anneau de focus visible + `aria-label` sur la zone. |
| B-4 | **P2** | **Icon-only buttons** : plusieurs boutons à icône seule (retirer, supprimer ligne) — présence d'`aria-label` à auditer systématiquement. | Garantir `aria-label` sur tous les boutons icône. |
| B-5 | **P2** | **Pas de mode clair** ni de préférence contraste. Acceptable en interne, mais tableaux/lecture longue en sombre = fatigue. | Optionnel : thème clair pour l'impression/lecture, ou renfort de contraste. |
| B-6 | **P3** | **Feedback de sauvegarde** hétérogène (nouveau : « Enregistré ✓» en `text-ok` ; ailleurs toasts/états différents). | Uniformiser le pattern de confirmation. |
| B-7 | **P2** | **QA visuelle multi-breakpoint non faite** (320→1920). Le cockpit est dense (sidebar, tableaux, modales). | Passe `design-review` sur les breakpoints clés une fois l'accès dispo. |

---

## C. Cohérence système de marques (les 4 sociétés)

- 4 accents : rouge (OM²), vert (CED), bleu (Suivisio), bleu (Brume) → cf. **A-1**
  (collision bleue) et **A-2/A-3** (logos).
- Traitement logo hétérogène (transparent/blanc/sigle) géré au cas par cas :
  fonctionnel, mais pas encore un **système** documenté.
- **Manque** : un mini **brand-book** (par société : accent hex, logo de
  référence, tailles, fond clair/foncé) pour verrouiller la cohérence.

---

## Priorisation (si passe `fix` design ensuite)

1. **A-1** différencier Suivisio/Brume · **A-2** logo CED unique (image de marque).
2. **B-1** regrouper les exports de marque en menu · **B-2** contraste AA.
3. **A-5** vue lecture du compte rendu · **B-3/B-4** accessibilité éditeur.
4. **C** brand-book · **B-7** QA visuelle multi-breakpoint.

> Aucune modification effectuée. Dis « fix design » (ou choisis des items) pour
> que je corrige — chaque correctif avec typecheck/build avant commit.
