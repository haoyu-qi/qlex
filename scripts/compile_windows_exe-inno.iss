; qlex unsigned Windows x64 installer. Run after `flutter build windows --release`.

#define MyAppName "qlex"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "qlex contributors"
#define MyAppURL "https://github.com/haoyu-qi/qlex"
#define MyAppExeName "qlex.exe"
#define MyAppSource "..\app\build\windows\x64\runner\Release"

[Setup]
AppId={{A8E93C0B-EC76-4D22-94D4-7017C976D599}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\qlex
DefaultGroupName=qlex
DisableProgramGroupPage=yes
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=qlex-0.1.0-windows-x64-setup
SetupIconFile=..\app\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#MyAppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\qlex"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\qlex"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,qlex}"; Flags: nowait postinstall skipifsilent
