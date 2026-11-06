# NX Infinity source and dependency notices

NX Infinity Core is a fork of Kenji-NX at `7d1fd99d3dc1c230ef7f823e96f187b3de619e4a`, descended from Ryujinx. The actual native source is in `core/`; its original copyright and MIT license remain in `core/LICENSE.txt`. Internal Ryujinx project names preserve upstream identity and compatibility. Renaming the product does not change those credits or licenses.

The product contains one compiled emulator host under `cores/nxi`. Eden, Citron and Canary workers are not part of this source build. Historical patch records and compatibility reports identify the origins of investigated behavior. Their presence does not indicate that those engines are installed or selectable. Original four-core notices are retained as historical evidence in `docs/fork-provenance/previous-four-core-notices.md`.

| Component | Retained source/notices |
|---|---|
| Kenji-NX/Ryujinx native implementation | `core/LICENSE.txt`, `core/distribution/legal/THIRDPARTY.md`, original source headers, `host/nxi/NOTICES.md` |
| Native dependencies, including LibHac, SDL, OpenAL, FFmpeg and Shaderc | Target-specific package locks and dependency records in `host/nxi/`, package notices, and `host/shared/licenses/` |
| NX-owned launcher/runtime work | `LICENSE`; this grant does not replace inherited component licenses |
| Avalonia, SkiaSharp, HarfBuzzSharp, MicroCom and D-Bus dependencies | `launcher/NxInfinity/packages.lock.json`, `dependencies.json`, and `licenses/` |
| Inter font | Original SIL OFL notice in the launcher license files |
| Dune design adaptation, sakasakiking | `launcher/NxInfinity/licenses/Dune-MIT.txt` |
| TOTK Dynamic FPS timing component | `third_party/totk-dfps/`, its GPL-2.0 license, source provenance, and exact-build timing resources; do not describe the complete bundle as MIT-only |
| .NET | SDK 10.0.402 and bundled runtime 10.0.13; original license/notices copied from the actual runtime pack |
| Optional translator/OCR runtime | Pinned inputs and notices in `third_party/translation/` and the assembled runtime |
| Authored homebrew fixtures | Source, toolchain provenance and libnx/newlib/GCC notices under `tests/homebrew/` |
| Project branding | User-supplied assets and their provenance under `assets/branding/` |

Native package hashes identify the build inputs but do not replace corresponding-source and redistribution obligations. Exact native dependency source/build correspondence remains a public distribution review item. Development test archives do not claim that this review or commercial-game qualification is complete.

No Nintendo game content, keys, firmware, DLC, proprietary SDK libraries or save dumps are included. Keep the source archive and all applicable original notices with the development build.
