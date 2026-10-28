# Licence notice

Copyright (C) 2026 Omar Nawaz

TING's source code is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by the
Free Software Foundation, either **version 3 of the License, or (at your option)
any later version**.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program (the [LICENSE](LICENSE) file). If not, see
<https://www.gnu.org/licenses/>.

SPDX-License-Identifier: AGPL-3.0-or-later

## What the code licence does not cover

The AGPL covers the **source code**. It does not license, and nobody may reuse
under it:

- **Organisation names and logos**, including those under
  `public/brand/` that belong to Tryggere Ruspolitikk, Tryggere Ungdom and
  Under The Rug, and the photographs under `public/brand/utr/`.
- **People and personal data** in the fixtures and demo seed: names, photographs
  and any other details of real people.
- The **TING name and brand marks** as an identity for a different service.

The owners gave permission for these to be included so that outside reviewers
can run and inspect TING locally. That permission is not a licence for
downstream reuse: do not redistribute them, use them in a derived service, or
imply endorsement. A fork must replace them. Where a file has its own terms,
those terms apply to that file.

## Third-party software

TING depends on open-source packages that keep their own licences, which are
distributed with each package in `node_modules/` and listed in
`package-lock.json`. The direct dependencies are under MIT, MIT-0, BSD-2-Clause,
Apache-2.0 and (MPL-2.0 OR Apache-2.0) terms. Notably, `dompurify`, `mammoth`,
`nodemailer`, `pdfjs-dist`, `sharp`, `emojibase-data` and `fflate` are used as
libraries and are not relicensed. The Inter and Source Serif 4 typefaces are
loaded through `next/font/google` and are under the SIL Open Font License 1.1.
The sample icons in `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
`window.svg`) come from the Next.js starter template.

Existing copyright and licence notices in third-party code must be kept.
