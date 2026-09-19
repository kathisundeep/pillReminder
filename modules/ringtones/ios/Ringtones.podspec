Pod::Spec.new do |s|
  s.name           = 'Ringtones'
  s.version        = '0.1.0'
  s.summary        = "Device sounds for alarms"
  s.description    = "Lists the phone's sounds on Android; imports user audio into Library/Sounds on iOS."
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '13.4', :tvos => '13.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
