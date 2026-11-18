# BFTM Planner: design system

The visual and interaction rules every screen follows. The ui-designer skill owns this file and adds to it when a screen needs something new. The frontend skill builds only from what is here and in `docs/design/<story-id>.md`.

Status: **draft**. The first ui-designer run confirms the open choices (marked _choose_) with the user and fills in the tokens.

## Principles

1. **Field first.** The app is used on a phone, outdoors, often one-handed, on a weak connection. Design every screen at 360 px wide first.
2. **A work tool, not a landing page.** Information comes first, decoration never. Every pixel either shows data or helps act on it.
3. **One primary action per screen.** It is the most visible control, and it sits within thumb reach on mobile.
4. **Show status, not decoration.** Stage, Outcome and progress must be readable at a glance, without relying on colour alone.
5. **Plain Bahasa Indonesia.** Short, direct labels, using glossary terms.

## Not AI slop

The app should look like a tool made for this team, not like a generated template. The ui-designer checks every design against this list, and the frontend checks every built screen against it.

**Never:**

- Gradients on backgrounds, buttons or text. No purple, indigo or violet as a default accent.
- Glassmorphism, blur panels, glows, neon, decorative blobs, or stock illustrations.
- Emoji in the UI.
- Hero sections, marketing headlines ("Kelola Pipeline Anda dengan Mudah"), or "Selamat datang kembali" greetings on a work screen.
- A grid of identical cards with an icon on top, for content that is really a list or a table.
- Stat tiles that show a bare number with no comparison, target or period ("12 Prospect"). A number needs context: against a target, against last week, or over a stated period.
- `rounded-2xl` plus `shadow-lg` on everything. Radius and elevation follow the tokens below and carry meaning.
- Icons that decorate instead of identify. An icon appears only where it carries information (Stage, Outcome, an action) or is a standard control.
- Placeholder content: lorem ipsum, "John Doe", "Acme". Design and test with realistic synthetic Indonesian data, such as "SDN 3 Cibinong", "Pasar Kramat Jati Blok B" or "PT Sinar Logistik". Never use real customer data.
- A narrow centred column on desktop. Use the width for tables, the map and side panels.
- The untouched shadcn default look. Accent, radius and font are chosen on purpose (see Foundations).
- Filler copy: "Something went wrong", "No data", "Click here". Say what happened and what to do next.

**Always:**

- A restrained palette: a neutral base, one brand accent, and semantic colours for status only.
- Hierarchy from size, weight and spacing, not from many colours.
- Tabular numerals for counts, Target / Actual and dates in tables.
- Real density on desktop: compact rows, aligned columns, and no oversized padding.
- Copy written for this specific task and user.

## Foundations

- **Components:** shadcn/ui on Tailwind CSS. Reuse a shadcn component before writing a new one.
- **Colour:** shadcn CSS variables, defined once in `app/globals.css`. Never hard-code hex values in components. Support light and dark mode.
  - Accent: _choose_ one, deliberately, at the first ui-designer run.
  - Status colours: success, warning, danger and info, used only for status.
- **Type:** _choose_ one family, loaded with `next/font`, with tabular figures (for example IBM Plex Sans or Source Sans 3). Body text is at least 16 px on mobile. The type scale is _choose_, with four sizes at most.
- **Radius:** _choose_ one base radius. Inputs, buttons and cards share it.
- **Elevation:** flat by default. Shadows only for overlays: menus, dialogs and sheets.
- **Spacing:** the Tailwind 4 px scale. The page gutter is 16 px on mobile and 24 px on desktop.
- **Icons:** lucide-react. An icon on its own needs an `aria-label`.
- **Numbers and dates:** Indonesian formats. "1.250 rekening", "18 Nov 2026", "14.30 WIB".

## Responsive rules

Every screen is checked at three viewports. These are also the Playwright projects.

| Name | Size | Layout |
|------|------|--------|
| mobile | 360 × 800 | One column, bottom navigation, a floating primary action |
| tablet | 768 × 1024 | One or two columns, bottom navigation or sidebar per the page pattern |
| desktop | 1280 × 800 | Sidebar, multi-column, tables and side panels |

Every screen, at every viewport:

- **No horizontal page scroll.** Only a table or the map may scroll inside its own box.
- **Tables become card lists** below `md` (768 px). Each card keeps the same fields, in priority order.
- **Touch targets** are at least 44 × 44 px on mobile and tablet.
- **Nothing hidden behind fixed bars.** Fixed bottom bars add safe-area padding (`env(safe-area-inset-bottom)`), and the last item stays reachable.
- **Long names wrap** rather than overflow. Truncation is allowed only where the full text is reachable in one tap.
- **Forms** use full-width inputs on mobile, and input types that open the right keyboard (`tel`, `number`, `date`, `email`).
- **The map** fills the viewport height minus the navigation, with a toggle to switch to the list on mobile.
- **Dialogs** become bottom sheets on mobile.

## Layout patterns

- **App shell:** a bottom navigation bar on mobile and a sidebar on desktop. The top bar shows the page title, plus a back control on detail pages.
- **List page:** search and filters at the top, then a list of cards on mobile or a table on desktop. The primary action ("Tambah ...") is a floating button on mobile and a button in the header on desktop.
- **Detail page:** a header with the name and status badges, then tabs or sections.
- **Form:** one column, a label above each field, and errors under the field. Submit is at the bottom, and is sticky on mobile.
- **Map:** full width, with a list toggle. Markers combine a colour with a Stage label or icon, so colour is never the only signal.

## Status display

- **Stage:** a badge with the Stage name. Its colour comes from the Stage's position in the Pipeline Template, early to late.
- **Outcome:** Won, Lost and On Hold each have a badge with an icon and a label.
- **Workflow Progress:** a progress bar with a text value ("3/8 Tugas").

## States

Every data view defines all four states:

- **Loading:** skeletons shaped like the content. No full-page spinners.
- **Empty:** one sentence saying what will appear here, plus the primary action.
- **Error:** what went wrong in plain words, plus a "Coba lagi" (try again) action. Keep the user's input.
- **Normal:** the data, including the longest realistic names and the largest realistic counts.

## Copy rules

- Use Bahasa Indonesia for all UI text; code identifiers stay in English.
- Buttons are verbs: "Simpan", "Tambah Prospect", "Batal".
- Errors say what happened and what to do: "Foto gagal diunggah. Periksa koneksi, lalu coba lagi."
- Use glossary terms as written. Where a term needs an Indonesian label, record it below the first time it is used.

## Glossary labels in the UI

| Term | UI label |
|------|----------|
| (filled in by ui-designer as screens are designed) | |

## Accessibility

Meet WCAG 2.1 AA: contrast of 4.5:1 for text, a visible focus ring, a logical focus order, a label on every input, and no information carried by colour alone.

## Design review checklist

Run on every frontend story, against screenshots at all three viewports, before the story is `Done`:

1. It matches `docs/design/<story-id>.md`: layout, states and copy.
2. It passes every item in "Not AI slop".
3. It passes every responsive rule, at 360, 768 and 1280.
4. All four states have been seen, not only the normal state.
5. The longest realistic content does not break the layout.
6. Contrast, focus ring and labels pass.
