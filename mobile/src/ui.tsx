import React, {
  Children,
  PropsWithChildren,
  useEffect,
  useReducer,
  useRef,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaFrame,
} from "react-native-safe-area-context";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Search,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { Product, money, stockLabel } from "./model";
import { columnBasis, useFormLayout, useKeyboardVisible } from "./layout";

export const colors = {
  blue: "#2563EB",
  pale: "#EFF5FF",
  background: "#F7F8FA",
  white: "#FFFFFF",
  text: "#17243C",
  muted: "#647084",
  border: "#E9ECF1",
  green: "#16866D",
  orange: "#A56B12",
  red: "#C63F4A",
};
export function Button({
  title,
  onPress,
  icon: Icon,
  kind = "primary",
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  icon?: LucideIcon;
  kind?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  const color =
    kind === "primary"
      ? colors.white
      : kind === "danger"
        ? colors.red
        : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === "primary" ? s.primary : s.secondary,
        (pressed || disabled || busy) && s.dim,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : Icon ? (
        <Icon color={color} size={19} />
      ) : null}
      <Text style={[s.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, (disabled || pressed) && s.dim]}
    >
      <Icon size={22} color={colors.text} />
    </Pressable>
  );
}
export function Field({
  label,
  accessory,
  ...props
}: TextInputProps & { label: string; accessory?: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputFrame, props.editable === false && s.dim]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          underlineColorAndroid="transparent"
          {...props}
          numberOfLines={props.multiline ? props.numberOfLines : 1}
          style={[s.input, props.multiline && s.textarea, props.style]}
        />
        {accessory}
      </View>
    </View>
  );
}
export function Columns({
  children,
  minimum = 160,
}: PropsWithChildren<{ minimum?: number }>) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={s.columns}>
      {Children.toArray(children).map((child, index) => (
        <View
          key={index}
          style={[s.column, { flexBasis: columnBasis(fontScale, minimum) }]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.caption}>{label}</Text>
      <Text selectable style={s.detailValue}>
        {value}
      </Text>
    </View>
  );
}
export function SearchField({
  value,
  onChangeText,
  placeholder = "搜索商品名称、条码或分类",
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={s.search}>
      <Search size={19} color={colors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        numberOfLines={1}
        value={value}
        onChangeText={onChangeText}
        style={s.searchInput}
        autoCapitalize="none"
      />
      {value ? (
        <IconButton
          icon={X}
          label="清空搜索"
          onPress={() => onChangeText("")}
        />
      ) : null}
    </View>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={s.error}>
      <TriangleAlert color={colors.red} size={18} />
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}
export function Card({ children }: PropsWithChildren) {
  return <View style={s.card}>{children}</View>;
}
export function KeyboardSafeArea({ children }: PropsWithChildren) {
  const frame = useSafeAreaFrame();
  const keyboardVisible = useKeyboardVisible();
  // At the window root, padding uses only the remaining keyboard overlap.
  // This also handles edge-to-edge windows where adjustResize does not shrink the root.
  return (
    <KeyboardAvoidingView
      testID="keyboard-safe-root"
      style={s.fill}
      behavior="padding"
      enabled={keyboardVisible}
      keyboardVerticalOffset={frame.y}
    >
      <SafeAreaView style={s.fill}>{children}</SafeAreaView>
    </KeyboardAvoidingView>
  );
}
export function Empty({
  title = "暂无记录",
  detail = "调整筛选条件，或添加第一条记录。",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <View style={s.empty}>
      <Box size={34} color={colors.muted} />
      <Text style={s.subtitle}>{title}</Text>
      <Text style={s.caption}>{detail}</Text>
    </View>
  );
}
export function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.chips}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: value === option.id }}
          onPress={() => onChange(option.id)}
          style={[
            s.chip,
            { maxWidth: Math.min(280, width - 40) },
            value === option.id && s.selectedChip,
          ]}
        >
          <Text
            numberOfLines={2}
            style={[s.chipText, value === option.id && s.selectedChipText]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function StockBadge({ product }: { product: Product }) {
  const color =
    product.stock === 0
      ? colors.red
      : product.stock <= product.threshold
        ? colors.orange
        : colors.green;
  return (
    <View style={[s.badge, { backgroundColor: `${color}12` }]}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>
        {stockLabel(product)}
      </Text>
    </View>
  );
}
export function ProductRow({
  product,
  onPress,
}: {
  product: Product;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}，库存 ${product.stock} ${product.unit}`}
      onPress={onPress}
      style={s.productRow}
    >
      <View style={s.row}>
        <View style={s.productIcon}>
          <Box color={colors.blue} size={24} />
        </View>
        <View style={s.grow}>
          <Text numberOfLines={2} style={s.rowTitle}>
            {product.name}
          </Text>
          <Text numberOfLines={1} style={s.caption}>
            {product.barcode}
          </Text>
        </View>
        <ChevronRight color={colors.muted} size={16} />
      </View>
      <View style={s.inline}>
        <Text style={[s.caption, { flexShrink: 1 }]}>{product.category}</Text>
        <StockBadge product={product} />
      </View>
      <View style={s.productFacts}>
        <Text style={s.fact}>
          库存 {product.stock} {product.unit}
        </Text>
        <Text style={s.fact}>售价 {money(product.price)}</Text>
      </View>
    </Pressable>
  );
}
export function ScreenModal({
  title,
  onClose,
  dirty = false,
  busy = false,
  children,
  footer,
  error = "",
  errorRevision = 0,
}: PropsWithChildren<{
  title: string;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
  footer?: React.ReactNode;
  error?: string;
  errorRevision?: number;
}>) {
  const close = () => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert("放弃修改？", "当前未保存的内容将丢失。", [
      { text: "继续编辑", style: "cancel" },
      { text: "放弃修改", style: "destructive", onPress: onClose },
    ]);
  };
  const hardwareBack = () => {
    // Android may dispatch the dialog's back callback while hiding its IME.
    // Blur the field first; a second back press can then close the form.
    if (Keyboard.isVisible() || TextInput.State.currentlyFocusedInput()) {
      Keyboard.dismiss();
      return;
    }
    close();
  };
  return (
    <Modal visible animationType="slide" onRequestClose={hardwareBack}>
      <SafeAreaProvider>
        <ModalBody
          title={title}
          close={close}
          busy={busy}
          footer={footer}
          error={error}
          errorRevision={errorRevision}
        >
          {children}
        </ModalBody>
      </SafeAreaProvider>
    </Modal>
  );
}
function ModalBody({
  title,
  close,
  busy,
  footer,
  error,
  errorRevision,
  children,
}: PropsWithChildren<{
  title: string;
  close: () => void;
  busy: boolean;
  footer?: React.ReactNode;
  error: string;
  errorRevision: number;
}>) {
  const { inlineFooter } = useFormLayout();
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (!error) return;
    const frame = requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y: 0, animated: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [error, errorRevision]);
  return (
    <KeyboardSafeArea>
      <View style={s.header}>
        <IconButton
          icon={ArrowLeft}
          label="返回"
          onPress={close}
          disabled={busy}
        />
        <Text style={s.modalTitle}>{title}</Text>
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[s.content, s.pageContent]}
      >
        <ErrorNotice message={error} />
        {children}
        {inlineFooter && footer ? (
          <View testID="inline-form-actions" style={s.inlineFooter}>
            {footer}
          </View>
        ) : null}
      </ScrollView>
      {!inlineFooter && footer ? (
        <View testID="fixed-form-actions" style={[s.footer, s.pageContent]}>
          {footer}
        </View>
      ) : null}
    </KeyboardSafeArea>
  );
}
export function useFormError() {
  const [state, setError] = useReducer(
    (current: { message: string; revision: number }, message: string) => ({
      message,
      revision: current.revision + 1,
    }),
    { message: "", revision: 0 },
  );
  return { error: state.message, errorRevision: state.revision, setError };
}
// A ref prevents duplicate submissions before React has rendered the disabled button.
export function useSubmitLock() {
  const locked = useRef(false);
  return {
    enter: () => {
      if (locked.current) return false;
      locked.current = true;
      return true;
    },
    leave: () => {
      locked.current = false;
    },
  };
}
export const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  grow: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.55 },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  pageContent: { width: "100%", maxWidth: 760, alignSelf: "center" },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  column: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: "100%" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  between: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  alignEnd: { alignItems: "flex-end", gap: 5 },
  title: {
    fontSize: 27,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 18, fontWeight: "600", color: colors.text },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
  caption: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "500", color: colors.text },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    gap: 14,
  },
  button: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 9,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.blue },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center",
  },
  iconButton: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { gap: 8 },
  inputFrame: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 9,
  },
  input: {
    minHeight: 48,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text,
  },
  textarea: { minHeight: 92, textAlignVertical: "top" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingLeft: 12,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    fontSize: 14,
    color: colors.text,
  },
  error: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: "#FFF0F1",
    borderRadius: 10,
    padding: 13,
  },
  errorText: { color: colors.red, flex: 1, fontSize: 14, lineHeight: 21 },
  empty: { padding: 28, alignItems: "center", gap: 12 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedChip: { backgroundColor: colors.pale, borderColor: "#CEDDFC" },
  chipText: { color: colors.muted, fontSize: 14 },
  selectedChipText: { color: colors.blue, fontWeight: "600" },
  badge: {
    maxWidth: "100%",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  productRow: {
    gap: 12,
    paddingVertical: 17,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  productIcon: {
    flexShrink: 0,
    height: 46,
    width: 46,
    borderRadius: 11,
    backgroundColor: colors.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 60,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
  },
  footer: {
    flexShrink: 0,
    padding: 16,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  inlineFooter: {
    gap: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 16,
  },
  productFacts: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  fact: { flexShrink: 1, fontSize: 14, color: colors.text },
  detailRow: { gap: 6 },
  detailValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    minWidth: 0,
  },
  divider: { height: 1, backgroundColor: colors.border },
});
