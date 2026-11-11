; Установщик PVZ Master для Windows (Inno Setup). Ставится без прав администратора в папку пользователя,
; поэтому автообновление работает без запросов.
#define AppName "PVZ Master"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
[Setup]
AppId={{8B7E2C51-3D4A-4F0E-9C2B-5A1D6E7F9A10}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Necly2
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..
OutputBaseFilename=PVZ-Master-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppName}.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"; GroupDescription: "Ярлыки:"
[Files]
Source: "..\dist\PVZ Master\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppName}.exe"
Name: "{group}\Удалить {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppName}.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\{#AppName}.exe"; Description: "Запустить {#AppName}"; Flags: nowait postinstall skipifsilent
