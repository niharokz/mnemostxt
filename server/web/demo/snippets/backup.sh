#!/bin/sh
# Nightly copy of the notes folder.
set -eu
DEST="/backup/notes-$(date +%F)"
rsync -a --delete "$HOME/notes/" "$DEST/"
echo "backed up to $DEST"
