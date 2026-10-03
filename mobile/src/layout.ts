import { useEffect, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

// Let Yoga wrap whole columns before text or controls run out of room.
export const columnBasis = (fontScale: number, minimum = 160) =>
  minimum * Math.max(1, fontScale);
export const shouldInlineFooter = (
  height: number,
  fontScale: number,
  keyboardVisible: boolean,
) => keyboardVisible || height / Math.max(1, fontScale) < 500;

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export function useFormLayout() {
  const { height, fontScale } = useWindowDimensions();
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  return {
    inlineFooter: shouldInlineFooter(
      Math.min(frame.height || height, height) - insets.top - insets.bottom,
      fontScale,
      keyboardVisible,
    ),
  };
}
