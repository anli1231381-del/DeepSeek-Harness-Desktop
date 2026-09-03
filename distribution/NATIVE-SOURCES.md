# Native image libraries: source and replacement

The Windows runtime contains unmodified `sharp` 0.35.4 and its Windows x64
libvips 8.18.6 shared libraries. These include LGPL components and the
MPL-2.0 cairo component. Their terms are additional to Harness's MIT license.
This Windows x64 distribution omits the unused WebAssembly image fallback.
Full license texts are supplied in this directory; the installed packages
also retain their upstream README and license notices.

You may modify these libraries and debug such modifications. This distribution
does not restrict reverse engineering for that purpose. The Windows DLLs and
Node modules remain ordinary replaceable files under
`runtime/harness/node_modules/@img/sharp-win32-x64/lib/`. Stop the application
before replacing them with ABI-compatible builds.

Exact versions of every native dependency are recorded in the installed
`@img/sharp-win32-x64/versions.json`.

The accompanying release asset `native-image-sources-sharp-0.35.4.zip` contains
382 checksum-verified upstream source archives: the 28 native libraries,
sharp, sharp-libvips, Windows build recipes and MXE, plus all 350 registry
packages from librsvg's exact Cargo.lock. `sources/SOURCES.json` records the
download URL and SHA-256 for every archive. The original archives preserve
their own license notices. This source companion is a separate download;
ordinary app use does not require downloading it.

Extract the source companion, then extract the desired library archives with
`tar -xf <archive>`. Files ending in `.crate` are also source tar archives.
For rebuilding the native Windows DLL, follow `build.sh --help` and the
container/README instructions from `build-win64-mxe-8.18.6.tar.gz`; it contains
the actual patches and build options. `sharp-libvips-1.3.3.tar.gz` includes the
Windows packaging step and sharp's source contains the Node module wrapper.
The MXE source snapshot is branch `llvm-mingw-20260605`, commit
`d973945bb92c7783d5afa41bb2b8d2e1a04eaba3`. The source downloads for all linked
image libraries and librsvg Rust dependencies are included, so they need not
be obtained from the original upstream hosts to inspect or modify the code.
The original build recipes may require the files in their expected download
cache directories, Linux build tools and Docker.

Upstream project and build references:

- [sharp 0.35.4 source](https://github.com/lovell/sharp/archive/refs/tags/v0.35.4.tar.gz)
- [sharp-libvips 1.3.3 packaging, source versions and build scripts](https://github.com/lovell/sharp-libvips/tree/v1.3.3)
- [Windows libvips 8.18.6 build recipes, dependency source URLs, patches and instructions](https://github.com/libvips/build-win64-mxe/tree/v8.18.6)
- [libvips 8.18.6 source](https://github.com/libvips/libvips/archive/refs/tags/v8.18.6.tar.gz)

The Windows build's [dependency table](https://github.com/libvips/build-win64-mxe/blob/v8.18.6/README.md)
identifies each upstream project and exact source version. The LGPL components
are fribidi 1.0.16, glib 2.89.4, libexif 0.6.26, libheif 1.23.2,
librsvg 2.62.91, libvips 8.18.6, pango 1.58.2 and proxy-libintl 0.5;
cairo is 1.18.4 under MPL-2.0. Their unchanged source archives and the patches
used in the build recipes must remain available to recipients.

Release maintainers: always publish the generated source companion alongside
the installer, keep both available to recipients, and supply updated
corresponding source for any modified native library. The desktop `bundle`
script produces this companion automatically and the GitHub workflow attaches
it to the draft release. `distribution/native-sources.json` pins all source
hashes; changes to native dependency versions require regenerating this lock
from the updated upstream build recipes and Cargo.lock.
