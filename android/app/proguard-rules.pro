# React Native, AndroidX and ML Kit include their consumer ProGuard rules.

# RN 0.81 loads InspectorFlags even in release; its merged JNI library registers
# these classes by name. They have no reachable Java constructor in release, so
# keepclassmembers for native methods alone does not prevent R8 removing them.
-keep class com.facebook.react.devsupport.CxxInspectorPackagerConnection { *; }
-keep class com.facebook.react.devsupport.CxxInspectorPackagerConnection$* { *; }
