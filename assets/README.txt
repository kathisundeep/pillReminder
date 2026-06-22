Place app icon and splash images here:

  icon.png    - 1024 x 1024 PNG, app icon (used for launcher icon + notifications)
  splash.png  - 1284 x 2778 PNG (or any portrait size), shown on app launch

If you don't have these yet, you can:
  1. Use any solid-color 1024x1024 PNG for icon.png
  2. Use the same image as splash.png

EAS Build will fail if these files are missing. Quick fix:
  Generate a placeholder icon with: https://www.canva.com/  (export as PNG)
  Or run: npx expo-cli build:icon --help
