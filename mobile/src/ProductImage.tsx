import React, { useRef, useState } from 'react';
import {
  Animated, GestureResponderEvent, Image, ImageStyle, Modal, PanResponder,
  Pressable, StatusBar, StyleProp, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Minus, Plus, RotateCcw, X } from 'lucide-react-native';

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (e: GestureResponderEvent) => {
  const [a, b] = e.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
};

function ImageViewer({ uri, title, onClose }: { uri: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const translation = useRef(new Animated.ValueXY()).current;
  const state = useRef({ zoom: 1, x: 0, y: 0, width: 0, height: 0 });
  const gesture = useRef({ distance: 0, zoom: 1, x: 0, y: 0, dx: 0, dy: 0 });
  const pan = (x: number, y: number) => {
    const current = state.current;
    const maxX = current.width * (current.zoom - 1) / 2;
    const maxY = current.height * (current.zoom - 1) / 2;
    current.x = clamp(x, -maxX, maxX);
    current.y = clamp(y, -maxY, maxY);
    translation.setValue({ x: current.x, y: current.y });
  };
  const applyZoom = (value: number) => {
    state.current.zoom = clamp(value, 1, 4);
    scale.setValue(state.current.zoom);
    pan(state.current.x, state.current.y);
  };
  const changeZoom = (step: number) => { applyZoom(state.current.zoom + step); setZoom(state.current.zoom); };
  const reset = () => { applyZoom(1); pan(0, 0); setZoom(1); };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: e => e.nativeEvent.touches.length > 1 || state.current.zoom > 1,
    onMoveShouldSetPanResponder: e => e.nativeEvent.touches.length > 1 || state.current.zoom > 1,
    onPanResponderGrant: e => {
      gesture.current = { distance: distance(e), zoom: state.current.zoom, x: state.current.x, y: state.current.y, dx: 0, dy: 0 };
    },
    onPanResponderMove: (e, moved) => {
      const current = gesture.current;
      const span = distance(e);
      if (span > 0) {
        if (!current.distance) { current.distance = span; current.zoom = state.current.zoom; }
        applyZoom(current.zoom * span / current.distance);
        current.x = state.current.x; current.y = state.current.y;
        current.dx = moved.dx; current.dy = moved.dy;
      } else {
        current.distance = 0;
        pan(current.x + moved.dx - current.dx, current.y + moved.dy - current.dy);
      }
    },
    onPanResponderRelease: () => setZoom(state.current.zoom),
    onPanResponderTerminate: () => setZoom(state.current.zoom),
  })).current;
  const control = (label: string, Icon: typeof Plus, onPress: () => void, disabled = false) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.control, disabled && styles.disabled]}><Icon size={22} color="#fff" /></Pressable>;
  return <Modal visible animationType="fade" onRequestClose={onClose}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.page}>
        <StatusBar barStyle="light-content" backgroundColor="#111827" />
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {control('关闭图片预览', X, onClose)}
        </View>
        <View testID="image-viewer-stage" style={styles.stage} onLayout={e => {
          state.current.width = e.nativeEvent.layout.width; state.current.height = e.nativeEvent.layout.height;
          pan(state.current.x, state.current.y);
        }} {...responder.panHandlers}>
          {failed ? <Text style={styles.hint}>图片无法显示，请关闭后重试。</Text> : <Animated.View style={[styles.image, { transform: [{ translateX: translation.x }, { translateY: translation.y }, { scale }] }]}>
            <Image source={{ uri }} accessibilityLabel={`${title} 大图`} style={styles.image} resizeMode="contain" onError={() => setFailed(true)} />
          </Animated.View>}
        </View>
        <View style={styles.controls}>
          {control('缩小图片', Minus, () => changeZoom(-0.5), zoom <= 1)}
          <Text style={styles.ratio} accessibilityLabel="图片缩放比例">{Math.round(zoom * 100)}%</Text>
          {control('放大图片', Plus, () => changeZoom(0.5), zoom >= 4)}
          {control('重置图片', RotateCcw, reset)}
        </View>
        <Text style={styles.hint}>双指缩放，放大后可拖动图片</Text>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#111827' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 12 },
  title: { color: '#fff', fontSize: 16, flex: 1 },
  stage: { flex: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16, flexWrap: 'wrap' },
  control: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937', borderColor: '#475569', borderWidth: 1, borderRadius: 8 },
  disabled: { opacity: 0.4 },
  ratio: { color: '#fff', minWidth: 48, textAlign: 'center' },
  hint: { color: '#cbd5e1', textAlign: 'center', padding: 12, fontSize: 13 },
});
