import ExpoModulesCore
import AVFoundation

// The iOS half of the sound picker.
//
// iOS exposes NO system ringtones to third-party apps. There is no API to list
// Marimba or the built-in alarm sounds, let alone play them — this is an Apple
// restriction, not an omission here. WhatsApp on iPhone offers only its own
// bundled sounds for the same reason.
//
// What iOS DOES allow is a sound file inside the app container:
// UNNotificationSound(named:) resolves against the main bundle and against
// Library/Sounds. So a user can supply their own audio, and this copies it
// where the notification system can find it.
//
// Constraints that come from iOS, not from us:
//   * 30 seconds maximum, or iOS silently substitutes the default sound
//   * must be caf, aif or wav — an mp3 is rejected at play time, not at
//     registration, which is why the duration and type are checked on import
//     rather than discovered later as a silent alarm

public class RingtonesModule: Module {

  private var soundsDirectory: URL? {
    guard let library = FileManager.default.urls(
      for: .libraryDirectory, in: .userDomainMask
    ).first else { return nil }
    return library.appendingPathComponent("Sounds", isDirectory: true)
  }

  public func definition() -> ModuleDefinition {
    Name("Ringtones")

    // Always empty on iOS. The JS layer treats an empty list as "this platform
    // has no system sounds" and offers the import path instead, so there is no
    // separate capability flag to keep in sync.
    Function("getRingtones") { () -> [[String: String]] in
      return []
    }

    // Copies a user-chosen audio file into Library/Sounds and returns the name
    // to hand to UNNotificationSound. Throws with a reason the UI can show.
    AsyncFunction("importSound") { (sourceUri: String, name: String) -> String in
      guard let directory = self.soundsDirectory else {
        throw Exception(name: "ERR_NO_SOUNDS_DIR", description: "Could not open the app's sound folder.")
      }
      guard let source = URL(string: sourceUri) else {
        throw Exception(name: "ERR_BAD_URI", description: "That file could not be read.")
      }

      let ext = source.pathExtension.lowercased()
      guard ["caf", "aif", "aiff", "wav"].contains(ext) else {
        throw Exception(
          name: "ERR_UNSUPPORTED_TYPE",
          description: "iOS only plays caf, aif or wav files as alert sounds. \(ext.isEmpty ? "That file" : ".\(ext)") will not work."
        )
      }

      // Checked here because iOS does not complain — it just plays its own
      // default instead, which looks like the chosen sound being ignored.
      let duration = CMTimeGetSeconds(AVURLAsset(url: source).duration)
      if duration > 30 {
        throw Exception(
          name: "ERR_TOO_LONG",
          description: "iOS alert sounds must be 30 seconds or shorter. That one is \(Int(duration))s."
        )
      }

      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true
      )

      let safeName = name.replacingOccurrences(
        of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression
      )
      let destination = directory.appendingPathComponent("\(safeName).\(ext)")

      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.copyItem(at: source, to: destination)

      return destination.lastPathComponent
    }

    Function("listImportedSounds") { () -> [[String: String]] in
      guard let directory = self.soundsDirectory,
            let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path)
      else { return [] }

      return names.map { file in
        [
          "uri": directory.appendingPathComponent(file).absoluteString,
          "title": (file as NSString).deletingPathExtension,
          "type": "imported",
          "name": file,
        ]
      }
    }

    Function("deleteImportedSound") { (name: String) -> Bool in
      guard let directory = self.soundsDirectory else { return false }
      let target = directory.appendingPathComponent(name)
      try? FileManager.default.removeItem(at: target)
      return true
    }

    // Channels are an Android concept. Present so the JS layer can call the
    // same functions on both platforms without branching everywhere.
    Function("ensureAlarmChannel") { (_: String, _: String, _: String?) -> Bool in false }
    Function("deleteChannel") { (_: String) -> Bool in false }
    Function("listChannelIds") { () -> [String] in [] }
    Function("channelSound") { (_: String) -> String? in nil }
  }
}
