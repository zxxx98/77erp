import React, { PropsWithChildren, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

export const colors = {
  blue: "#2563EB",
  pale: "#EFF5FF",
  background: "#F7F8FA",
  white: "#FFFFFF",
  text: "#17243C",
  muted: "#7E8798",
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
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={s.iconButton}
    >
      <Icon size={22} color={colors.text} />
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[s.input, props.multiline && s.textarea, props.style]}
      />
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.chips}
    >
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.id }}
          onPress={() => onChange(option.id)}
          style={[s.chip, value === option.id && s.selectedChip]}
        >
          <Text style={[s.chipText, value === option.id && s.selectedChipText]}>
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
      <View style={s.productIcon}>
        <Box color={colors.blue} size={24} />
      </View>
      <View style={s.grow}>
        <Text style={s.rowTitle}>{product.name}</Text>
        <Text style={s.caption}>{product.barcode}</Text>
        <View style={s.inline}>
          <Text style={s.caption}>{product.category}</Text>
          <StockBadge product={product} />
        </View>
      </View>
      <View style={s.alignEnd}>
        <Text style={s.rowTitle}>
          {product.stock} <Text style={s.caption}>{product.unit}</Text>
        </Text>
        <Text style={s.caption}>{money(product.price)}</Text>
      </View>
      <ChevronRight color={colors.muted} size={16} />
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
}: PropsWithChildren<{
  title: string;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
  footer?: React.ReactNode;
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
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.fill} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={s.fill} behavior="height">
          <View style={s.header}>
            <IconButton icon={ArrowLeft} label="返回" onPress={close} />
            <Text style={s.modalTitle}>{title}</Text>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {children}
          </ScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
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
  grow: { flex: 1 },
  dim: { opacity: 0.55 },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  between: {
    flexDirection: "row",
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
  buttonText: { fontSize: 15, fontWeight: "600" },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { gap: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 9,
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
  searchInput: { flex: 1, padding: 12, fontSize: 14, color: colors.text },
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
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 17,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  productIcon: {
    height: 46,
    width: 46,
    borderRadius: 11,
    backgroundColor: colors.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 60,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, flex: 1 },
  footer: {
    padding: 16,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  divider: { height: 1, backgroundColor: colors.border },
});
