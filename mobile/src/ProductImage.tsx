import React, { useState } from 'react';
import {
  Image, ImageStyle, Modal, Pressable, StatusBar, StyleProp, StyleSheet, Text,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

export function ProductImage({ uri, label, style }: {
  uri: string;
  label: string;
  style: StyleProp<ImageStyle>;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`放大查看 ${label}`} onPress={e => { e.stopPropagation(); setOpen(true); }}>
      <Image source={{ uri }} accessibilityLabel={label} style={style} resizeMode="contain" />
    </Pressable>
    {open && <ImageViewer uri={uri} title={label} onClose={() => setOpen(false)} />}
  </>;
}

function ImageViewer({ uri, title, onClose }: { uri: string; title: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.page}>
        <StatusBar barStyle="light-content" backgroundColor="rgba(0, 0, 0, 0.65)" />
        <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" onPress={onClose} style={styles.close}><X size={24} color="#fff" /></Pressable>
        <Pressable testID="image-viewer-backdrop" accessible={false} style={styles.stage} onPress={onClose}>
          <Pressable accessible={false} style={styles.imageFrame} onPress={e => e.stopPropagation()}>
            {failed ? <Text accessibilityRole="alert" style={styles.error}>图片无法显示，请关闭后重试。</Text> : <Image source={{ uri }} accessibilityLabel={`${title} 大图`} style={styles.image} resizeMode="contain" onError={() => setFailed(true)} />}
          </Pressable>
        </Pressable>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, backgroundColor: 'rgba(0, 0, 0, 0.65)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  imageFrame: { width: '100%', maxWidth: 640, height: 480, maxHeight: '70%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  close: { alignSelf: 'flex-end', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  error: { color: '#fff', textAlign: 'center', padding: 12 },
});
