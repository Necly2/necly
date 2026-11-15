# iOS: обвязка проекта и сборка на Mac

> Полноценные папки `ios/` и `android/` генерирует сам Flutter командой
> `flutter create` — их не стоит писать руками (сломается Xcode-проект).
> Поэтому здесь: что сгенерировать и какие **правки** внести. Все шаги — на **Mac**.

## 0. Предусловия (один раз)
```bash
# Flutter SDK
# https://docs.flutter.dev/get-started/install/macos  🔸 сверь актуальные шаги
# Xcode — из App Store, затем:
sudo xcodebuild -license accept
xcode-select --install          # command line tools
# CocoaPods (для iOS-зависимостей)
sudo gem install cocoapods
flutter doctor                  # должно быть всё зелёное для iOS
```

## 1. Сгенерировать нативные папки
Из каталога `apps/fitness/`:
```bash
flutter create --platforms=ios,android --project-name necly_fitness .
```
Это создаст `ios/` и `android/`, **не трогая** твой `lib/`, `pubspec.yaml`, `assets/`.

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # генерит database.g.dart
```

## 2. Разрешение камеры (для сканера штрих-кодов)
`mobile_scanner` требует доступ к камере. Добавь в **`ios/Runner/Info.plist`**
внутри корневого `<dict>`:
```xml
<key>NSCameraUsageDescription</key>
<string>Нужен доступ к камере, чтобы сканировать штрих-коды продуктов.</string>
```
(Для Android — в `android/app/src/main/AndroidManifest.xml`:
`<uses-permission android:name="android.permission.CAMERA"/>`.)

## 3. Минимальная версия iOS
`mobile_scanner` обычно требует iOS 13+. В `ios/Podfile` раскомментируй/поставь:
```ruby
platform :ios, '13.0'
```
🔸 Если `pod install` ругнётся на версию — подними цифру по тексту ошибки.

## 4. Запуск в симуляторе
```bash
open -a Simulator          # запустить iPhone-симулятор
flutter run                # собрать и запустить
```
Юнит-тесты логики (нагрузка, CSV) — без симулятора:
```bash
dart test
```

## 5. Установка на свой физический iPhone
1. Подключи iPhone кабелем, доверь компьютеру.
2. Открой проект в Xcode: `open ios/Runner.xcworkspace` (именно `.xcworkspace`, не `.xcodeproj`).
3. Runner → Signing & Capabilities:
   - поставь галочку **Automatically manage signing**;
   - в **Team** выбери свой Apple ID (бесплатный подойдёт; добавить:
     Xcode → Settings → Accounts → «+»);
   - смени **Bundle Identifier** на уникальный, напр. `com.yourname.neclyfitness`.
4. Собери и запусти:
   ```bash
   flutter run --release
   ```
   или кнопкой ▶ в Xcode, выбрав свой iPhone.
5. На телефоне: Настройки → Основные → VPN и управление устройством → доверить
   своему developer-профилю.

### Ограничения бесплатного Apple ID
- Приложение «протухает» через **7 дней** — нужно переустанавливать (`flutter run` снова).
- Лимит ~3 приложений на устройство.
- Постоянная установка без переподписи → платный **Apple Developer Program** ($99/год).
  🔸 Условия и цены могли измениться — проверь на developer.apple.com.

## 6. Если Mac'а нет
- **Быстрый путь:** запусти под **Android** — нужен только Linux/Windows + Android SDK,
  кодовая база та же (`flutter run` на Android-устройстве/эмуляторе).
- **Облачная сборка iOS:** Codemagic / Bitrise умеют собирать Flutter под iOS в облаке.
  🔸 Для установки на устройство всё равно нужны сертификаты Apple; разберись с их
  требованиями — лично не проверял.

## Проверочный чек-лист
- [ ] `flutter doctor` — iOS toolchain зелёный
- [ ] `flutter pub get` без ошибок
- [ ] `dart run build_runner build` создал `lib/db/database.g.dart`
- [ ] `dart test` — тесты проходят
- [ ] `NSCameraUsageDescription` добавлен в Info.plist
- [ ] приложение стартует, 336 упражнений загрузились, видно 3 вкладки
