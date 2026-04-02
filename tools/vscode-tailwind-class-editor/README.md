# YCode Tailwind Class Editor (VS Code Extension MVP)

Dieses Extension-MVP ist aus eurem YCode-Ansatz abgeleitet:  
`class` / `className` am Cursor erkennen, Klassen visuell in einer Sidebar bearbeiten, sofort in den Code zurückschreiben.

## Features

- Sidebar im Activity Bar: **YCode CSS**
- Erkennt `class="..."`, `className="..."`, `className={\`...\`}` (Template Literal)
- Zeigt aktuelle Klassen als Chips (Klick auf Chip = entfernen)
- Quick-Controls für:
  - Display
  - Font Size
  - Padding
  - Margin
  - Radius
  - Text Color
  - Background Color
- Custom-Class hinzufügen
- Live-Preview in der Sidebar (iframe + Tailwind CDN)

## Lokales Starten (Extension Development Host)

1. In den Plugin-Ordner wechseln:

   ```bash
   cd tools/vscode-tailwind-class-editor
   ```

2. Dependencies installieren:

   ```bash
   npm install
   ```

3. Build ausführen:

   ```bash
   npm run build
   ```

4. In VS Code:
   - Ordner `tools/vscode-tailwind-class-editor` öffnen
   - `F5` drücken (Run Extension)
   - Im neuen Extension Host die Activity Bar öffnen: **YCode CSS**

## Hinweise / Grenzen (MVP)

- Fokus liegt auf statischen Klassen-Strings.
- Komplexe dynamische `className`-Ausdrücke (ternaries/arrays mit JS-Logik) werden nicht komplett geparst.
- Konfliktauflösung ist bewusst pragmatisch (ähnlich eurer Gruppenlogik), nicht 1:1 der vollständige Builder-Mapping-Umfang.

## Nächste sinnvolle Ausbaustufen

- Parser für dynamische JSX-Ausdrücke
- Breakpoint/UI-State Controls (`hover:`, `max-md:` etc.)
- Direkter Zugriff auf eure bestehende Tailwind-Mapping-Logik als shared package
- Bessere Vorschlagsliste aus euren `tailwind-suggestions`
