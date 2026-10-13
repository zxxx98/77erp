import React, { useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { Contact } from "./model";
import { Field, colors, s } from "./ui";

export function ContactPicker({ contacts, label, value, selectedId, onSelect, onChange, disabled = false, loading = false }: {
  contacts: Contact[];
  label: string;
  value: string;
  selectedId?: number | null;
  onSelect: (contact: Contact) => void;
  onChange?: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = contacts.filter(c => `${c.name} ${c.person} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase()));
  const expand = () => { if (!open) setQuery(""); setOpen(true); };
  return (
    <View>
      <Field label={label} value={onChange ? value : open ? query : value}
        placeholder="选择往来单位，或输入名称、联系人、电话搜索"
        editable={!disabled} maxLength={onChange ? 100 : undefined}
        onFocus={expand}
        onChangeText={text => { setQuery(text); onChange?.(text); setOpen(true); }}
        accessory={<Pressable accessibilityRole="button" accessibilityLabel={`${open ? "收起" : "展开"}${label}列表`}
          accessibilityState={{ expanded: open && !disabled, disabled }} disabled={disabled}
          hitSlop={8} style={styles.toggle}
          onPress={() => { Keyboard.dismiss(); if (open) setOpen(false); else expand(); }}>
          <ChevronDown size={20} color={colors.muted} style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }} />
        </Pressable>}
      />
      {open && !disabled && <View style={styles.menu}>
        <ScrollView style={styles.options} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {loading ? <Text style={s.caption}>正在加载往来单位…</Text> : matches.map(contact => (
            <Pressable key={contact.id} accessibilityRole="button"
              accessibilityLabel={`${contact.role === "supplier" ? "供应商" : "客户"} · ${contact.name}${!contact.active ? "（已停用）" : ""}`}
              accessibilityState={{ selected: selectedId === contact.id }}
              style={({ pressed }) => [styles.option, (pressed || selectedId === contact.id) && styles.selected]}
              onPress={() => { onSelect(contact); setQuery(""); setOpen(false); Keyboard.dismiss(); }}>
              <Text style={[styles.badge, contact.role === "supplier" ? styles.supplier : styles.customer]}>{contact.role === "supplier" ? "供应商" : "客户"}</Text>
              <View style={styles.copy}>
                <Text style={styles.name}>{contact.name}{!contact.active && <Text style={s.caption}>（已停用）</Text>}</Text>
                {!!(contact.person || contact.phone) && <Text style={s.caption}>{[contact.person, contact.phone].filter(Boolean).join(" · ")}</Text>}
              </View>
              {selectedId === contact.id && <Check size={16} color={colors.blue} />}
            </Pressable>
          ))}
          {!loading && !matches.length && <Text style={[s.caption, styles.empty]}>{query.trim() ? "没有匹配的往来单位" : "暂无可选往来单位"}</Text>}
        </ScrollView>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { padding: 12 },
  menu: { padding: 5, marginTop: 6, marginBottom: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  options: { maxHeight: 240 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, padding: 10, borderRadius: 6 },
  selected: { backgroundColor: colors.pale },
  badge: { borderRadius: 5, paddingVertical: 4, paddingHorizontal: 7, fontSize: 11 },
  supplier: { color: colors.green, backgroundColor: "#EAF7F2" },
  customer: { color: colors.blue, backgroundColor: "#E7EFFF" },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  name: { color: colors.text, fontSize: 13, fontWeight: "600" },
  empty: { padding: 18, textAlign: "center" },
});
