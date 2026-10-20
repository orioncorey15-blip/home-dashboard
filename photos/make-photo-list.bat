@echo off
rem Double-click after adding/removing photos in this folder.
rem Writes photos.js, the list the dashboard reads (only needed when PHOTO_SOURCE is "local").
cd /d "%~dp0"
> photos.js echo var LOCAL_PHOTOS = [
for %%f in (*.jpg *.jpeg *.png *.gif *.webp) do >> photos.js echo   "%%f",
>> photos.js echo ];
echo Photo list updated:
type photos.js
pause
