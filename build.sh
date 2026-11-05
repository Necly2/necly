#!/bin/bash
# Сборка Sugrob.app (универсальная: Apple Silicon + Intel).
# Нужны только Command Line Tools: xcode-select --install
set -e
cd "$(dirname "$0")"

APP="build/Sugrob.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" build/tmp

for ARCH in arm64 x86_64; do
  swiftc -O -parse-as-library \
    -target "$ARCH-apple-macos13.0" \
    -framework Cocoa -framework ApplicationServices \
    Sources/*.swift \
    -o "build/tmp/Sugrob-$ARCH"
done
lipo -create build/tmp/Sugrob-arm64 build/tmp/Sugrob-x86_64 -output "$APP/Contents/MacOS/Sugrob"
rm -rf build/tmp

cp Info.plist "$APP/Contents/Info.plist"
codesign --force -s - "$APP"

echo "Готово: $APP"
echo "Запуск: open $APP"
