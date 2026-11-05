#!/bin/bash
# Сборка Lenta.app (универсальная: Apple Silicon + Intel).
set -e
cd "$(dirname "$0")"
APP="build/Lenta.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" build/tmp
for ARCH in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$ARCH-apple-macos13.0" -framework Cocoa \
    Sources/*.swift -o "build/tmp/Lenta-$ARCH"
done
lipo -create build/tmp/Lenta-arm64 build/tmp/Lenta-x86_64 -output "$APP/Contents/MacOS/Lenta"
rm -rf build/tmp
cp Info.plist "$APP/Contents/Info.plist"
codesign --force -s - "$APP"
echo "Готово: $APP"
