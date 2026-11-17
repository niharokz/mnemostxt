#!/bin/sh
# CI only (release-files job): uploads dist/release/* to the project's generic
# package registry under names that carry the tag (mnemostxt-v0.0.1.apk ...),
# which the release links in .gitlab-ci.yml point at, and writes
# release-notes.md from this version's CHANGELOG.md section.
set -eu
cd "$(dirname "$0")/.."
: "${CI_COMMIT_TAG:?run from a tag pipeline}" "${CI_JOB_TOKEN:?}" "${PKG_URL:?}"
V=$(tr -d ' \n\r' < VERSION)
T=$CI_COMMIT_TAG

echo
echo "Uploading to the package registry ($T)"
for pair in "mnemostxt-$V-amd64.deb:mnemostxt-$T-amd64.deb" "mnemostxt-$V-setup.exe:mnemostxt-$T-setup.exe" \
            "mnemostxt-$V.apk:mnemostxt-$T.apk" "SHA256SUMS:SHA256SUMS" "SHA256SUMS.sig:SHA256SUMS.sig"; do
  f=${pair%%:*}; n=${pair#*:}
  [ "$f" = SHA256SUMS.sig ] && [ ! -f "dist/release/$f" ] && continue # an unsigned build
  code=$(curl --silent --show-error --retry 3 --output /dev/null --write-out '%{http_code}' \
    --header "JOB-TOKEN: $CI_JOB_TOKEN" --upload-file "dist/release/$f" "$PKG_URL/$n")
  case "$code" in
    2??) printf '✓ %-32s %6s\n' "$n" "$(du -h "dist/release/$f" | cut -f1)" ;;
    *) printf '✗ %s — HTTP %s (a file with this name may already exist: delete it in Deploy → Package registry)\n' "$n" "$code"; exit 1 ;;
  esac
done

# this version's section of CHANGELOG.md ("## [X.Y.Z] - date"), without the link lines
awk -v v="$V" '$0 ~ "^## \\["v"\\]" {on=1; next} /^## / {on=0} on' CHANGELOG.md | sed '/^\[.*\]: http/d' > release-notes.md
[ -s release-notes.md ] || echo "mnemostxt $V" > release-notes.md
if [ -f dist/release/SHA256SUMS.sig ]; then
  {
    echo
    echo "### Check a download"
    echo "[SHA256SUMS]($PKG_URL/SHA256SUMS) is signed ([SHA256SUMS.sig]($PKG_URL/SHA256SUMS.sig)) with the key in"
    echo "\`docs/release-signing.pub\`. With both files and the key next to your download:"
    echo
    echo "    echo \"release \$(cat release-signing.pub)\" > signers"
    echo "    ssh-keygen -Y verify -f signers -I release -n mnemostxt-release -s SHA256SUMS.sig < SHA256SUMS"
    echo "    sha256sum --ignore-missing -c SHA256SUMS"
  } >> release-notes.md
fi
echo "✓ release notes from CHANGELOG.md ($(grep -c . release-notes.md) lines)"
