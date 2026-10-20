#!/bin/sh
# Run after adding/removing photos in this folder (Mac/Linux, or Termux on Android).
# Writes photos.js, the list the dashboard reads (only needed when PHOTO_SOURCE is "local").
cd "$(dirname "$0")" || exit 1
{
  echo "var LOCAL_PHOTOS = ["
  for f in *.jpg *.jpeg *.png *.gif *.webp *.JPG *.JPEG *.PNG; do
    [ -f "$f" ] && printf '  "%s",\n' "$(printf '%s' "$f" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  done
  echo "];"
} > photos.js
echo "Photo list updated:"; cat photos.js
