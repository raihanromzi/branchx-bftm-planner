# BFTM Planner: design system

The visual and interaction rules every screen follows. The ui-designer skill owns this file and adds to it when a screen needs something new. The frontend skill builds only from what is here and in `docs/design/<story-id>.md`.

Status: **confirmed** 2026-11-18. The user chose the accent, font, radius and type scale at the first ui-designer run.

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
- **Type:** Plus Jakarta Sans, loaded with `next/font/google` (weights 400, 500, 600), with `font-variant-numeric: tabular-nums` on every number in a table, a Target / Actual figure or a date column. Body text is at least 16 px on mobile.
- **Radius:** `--radius: 6px`. Inputs, buttons, cards, sheets and Stage badges share it. Only Outcome badges are pills (`rounded-full`), so the shape itself tells an Outcome from a Stage.
- **Elevation:** flat by default. Shadows only for overlays: menus, dialogs and sheets.
- **Spacing:** the Tailwind 4 px scale. The page gutter is 16 px on mobile and 24 px on desktop.
- **Icons:** lucide-react. An icon on its own needs an `aria-label`.
- **Numbers and dates:** Indonesian formats. "1.250 rekening", "18 Nov 2026", "14.30 WIB".

### Colour tokens

Why teal: it stays legible in outdoor light, is not the default bank blue or an AI-default purple, and stays clearly apart from the success green and the info blue.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--background` | `#FFFFFF` | `#15191C` | page |
| `--surface` (`--muted`) | `#F5F6F7` | `#1E2327` | grouped areas, table header, skeletons |
| `--foreground` | `#1C2024` | `#E8EBED` | text |
| `--muted-foreground` | `#5B636B` | `#9AA3AB` | secondary text (4.6:1 on white) |
| `--border` / `--input` | `#DDE1E4` | `#2E353A` | borders, inputs |
| `--primary` (accent) | `#0E6E73` | `#3FA9AE` | primary buttons, active nav, links |
| `--primary-hover` | `#0B5A5E` | `#5BBCC0` | hover and pressed |
| `--primary-foreground` | `#FFFFFF` | `#0A1F20` | text on accent |
| `--accent` (tint) | `#E6F2F2` | `#1B3436` | selected row, active nav background |
| `--ring` | `#0E6E73` | `#5BBCC0` | focus ring, 2 px plus a 2 px offset |
| `--success` | `#15803D` | `#4ADE80` | Won, On-site, Target reached |
| `--warning` | `#B45309` | `#FBBF24` | On Hold, Off-site, Overdue |
| `--danger` / `--destructive` | `#B91C1C` | `#F87171` | Lost, errors, destructive actions |
| `--info` | `#1D4ED8` | `#93C5FD` | neutral notices |

Status colours are used only for status, and always with an icon or a text label.

### Type scale

Four sizes, with line heights:

| Size | Use | Weight |
|------|-----|--------|
| 28 / 34 | page title on desktop, key figures (Realisasi) | 600 |
| 20 / 28 | page title on mobile, section titles, dialog titles | 600 |
| 16 / 24 | body, inputs, buttons, list rows on mobile | 400, labels 500 |
| 14 / 20 | table cells and meta on desktop, badges, helper and error text | 400 or 500 |

Hierarchy comes from size and weight. Labels are sentence case, never all caps.

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

- **Stage:** a badge (6 px radius) with the Stage name, preceded by a position mark of filled and empty dots ("●●●○○" for Stage 3 of 5, with `aria-hidden`; the badge's accessible name is "Presentasi, tahap 3 dari 5"). Its colour comes from the Stage's position, bucketed into five steps: `bucket = ceil(position / stageCount × 5)`.

  | Bucket | Background | Text |
  |--------|-----------|------|
  | 1 | `#EEF0F2` | `#3F464E` |
  | 2 | `#E1EEF0` | `#1F5A5E` |
  | 3 | `#C9E3E4` | `#0B4F53` |
  | 4 | `#0E6E73` | `#FFFFFF` |
  | 5 | `#0A4F53` | `#FFFFFF` |

  Dark mode uses the same steps on `#1E2327` to `#3FA9AE`. Defined as `--stage-1` to `--stage-5` tokens. The name is never truncated below 12 characters.
- **Outcome:** pill badges with an icon and a label. Won "Berhasil" (`CircleCheck`, success), Lost "Gagal" (`CircleX`, danger), On Hold "Ditunda" (`CirclePause`, warning). Tinted background, coloured text.
- **Overdue:** a "Terlambat" label with `Clock` in warning colour, next to the due date. Never colour alone.
- **Check-in site:** "Di lokasi (85 m)" (`MapPinCheck`, success) or "Di luar lokasi (1,2 km)" / "Di luar lokasi (GPS tidak tersedia)" (`MapPinX`, warning).
- **Inactive Funding Officer:** "Funding Officer nonaktif" in muted text with `UserX`.
- **Target vs Actual:** the Actual figure (28 px) over "dari 1.800 target (69%)", with a 6 px progress bar. The bar is accent below 100% and success at 100% or more, with "Tercapai" written out. The previous month is written as text: "Bulan lalu 1.020".
- **Workflow progress:** a progress bar with a text value ("3/8 Tugas").

## Map markers

A 32 px circle in the Stage bucket colour, with the Stage position number inside it in 14 px semibold. The number is a real sequence, so it is meaningful. Prospects without an open Pipeline use a hollow grey circle with "–". A Won latest Pipeline shows a `Check` and a Lost one an `X`, in the success and danger colours. Clusters are a dark neutral circle (`#1C2024`) with the white count. The legend lists the Stages with their numbers.

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
| Prospect | Prospect |
| Pipeline | Pipeline |
| Pipeline Template | Template Pipeline |
| Stage | Tahap (the Stage's own name is shown, such as "Presentasi") |
| Task | Tugas |
| Activity | Kegiatan |
| Check-in | Check-in |
| On-site / Off-site | Di lokasi / Di luar lokasi |
| Outcome: Won / Lost / On Hold | Berhasil / Gagal / Ditunda |
| Overdue | Terlambat |
| Target / Actual | Target / Realisasi |
| Accounts Opened | Rekening dibuka |
| Potential Accounts | Potensi rekening |
| Contact Person | Kontak |
| Category | Kategori |
| Funding Officer | Funding Officer |
| Admin | Admin |
| Archived | Diarsipkan |
| Schedule (screen) | Jadwal |
| Map (screen) | Peta |
| Settings (screen) | Pengaturan |

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
