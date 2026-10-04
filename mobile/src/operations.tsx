import React, { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { api } from "./native";
import { Order, Product } from "./model";
import {
  Button,
  Card,
  Field,
  ScreenModal,
  SearchField,
  s,
  useSubmitLock,
} from "./ui";

function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useSubmitLock(),
    request = useRef({ key: "", id: "" });
  const run = async (path: string, body: object, done: () => void) => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    const key = JSON.stringify([path, body]);
    if (key !== request.current.key)
      request.current = {
        key,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      };
    try {
      await api(path, "POST", { ...body, request_id: request.current.id });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  return { busy, error, setError, run };
}
export function OrderCorrection({
  order,
  onSaved,
}: {
  order: Order;
  onSaved: (message: string) => void;
}) {
  const { busy, error, setError, run } = useOperation();
  const [reason, setReason] = useState(""),
    [quantities, setQuantities] = useState<Record<number, string>>({});
  if (order.status === "void")
    return (
      <Card>
        <Text style={s.caption}>已作废：{order.void_reason}</Text>
      </Card>
    );
  if (order.stock_applied === 0)
    return (
      <Card>
        <Text style={s.caption}>期初已结转的演示单据不能作废或退货。</Text>
      </Card>
    );
  const confirm = (action: "void" | "returns") => {
    if (!reason.trim()) {
      setError("请填写操作原因。");
      return;
    }
    const selected = order.items.filter(
      (i) => quantities[i.product_id] && quantities[i.product_id] !== "0",
    );
    if (
      action === "returns" &&
      (!selected.length ||
        selected.some((i) => !/^\d+$/.test(quantities[i.product_id] || "")))
    ) {
      setError("请填写正整数退货数量。");
      return;
    }
    const body = {
      reason,
      ...(action === "returns"
        ? {
            items: selected.map((i) => ({
              product_id: i.product_id,
              quantity: Number(quantities[i.product_id]),
            })),
          }
        : {}),
    };
    Alert.alert(
      action === "void" ? "确认作废单据？" : "确认退货？",
      action === "void"
        ? "反向调整库存并保留原单，无法撤销作废。"
        : "按原单价格生成退货单并调整库存。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认提交",
          style: "destructive",
          onPress: () =>
            void run(`/orders/${order.id}/${action}`, body, () =>
              onSaved(action === "void" ? "单据已作废" : "退货单已生成"),
            ),
        },
      ],
    );
  };
  return (
    <Card>
      <Text style={s.subtitle}>单据纠正</Text>
      {!!order.source_order_id && (
        <Text style={s.caption}>关联原单 ID：{order.source_order_id}</Text>
      )}
      <Field
        label="操作原因"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        editable={!busy}
      />
      {order.kind !== "return" && (
        <>
          <Text style={s.caption}>
            退货沿用原单价格。数量留空或为 0 表示不退。
          </Text>
          {order.items.map((i) => (
            <Field
              key={i.product_id}
              label={`${i.name} 退货数量（可退 ${i.quantity - (i.returned_quantity || 0)}）`}
              value={quantities[i.product_id] || ""}
              onChangeText={(value) =>
                setQuantities({ ...quantities, [i.product_id]: value })
              }
              keyboardType="number-pad"
              editable={!busy}
            />
          ))}
          <Button
            title="确认退货"
            disabled={busy}
            onPress={() => confirm("returns")}
          />
        </>
      )}
      <Button
        title="作废单据"
        kind="danger"
        disabled={busy}
        onPress={() => confirm("void")}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={s.caption}>
          {error}
        </Text>
      )}
    </Card>
  );
}
type CountLine = {
  product_id: number;
  name: string;
  expected_stock: number;
  counted: string;
};
type Adjustment = {
  id: number;
  name: string;
  before_stock: number;
  after_stock: number;
  reason: string;
  created_at: string;
};
export function StocktakeEditor({
  products,
  onSaved,
  onClose,
}: {
  products: Product[];
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const { busy, error, setError, run } = useOperation();
  const [query, setQuery] = useState(""),
    [reason, setReason] = useState(""),
    [lines, setLines] = useState<CountLine[]>([]),
    [history, setHistory] = useState<Adjustment[]>([]);
  useEffect(() => {
    api<Adjustment[]>("/stocktakes")
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [setError]);
  const confirm = () => {
    if (
      !reason.trim() ||
      !lines.length ||
      lines.some((i) => !/^\d+$/.test(i.counted))
    ) {
      setError("请添加商品，填写实盘数量和盘点原因。");
      return;
    }
    Alert.alert(
      "确认盘点？",
      `${lines.length} 种商品将按实盘数量调整库存。库存变化时会拒绝提交，请刷新后重新盘点。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认提交",
          onPress: () =>
            void run(
              "/stocktakes",
              {
                reason,
                items: lines.map(({ product_id, expected_stock, counted }) => ({
                  product_id,
                  expected_stock,
                  counted: Number(counted),
                })),
              },
              () => onSaved("盘点已完成"),
            ),
        },
      ],
    );
  };
  return (
    <ScreenModal
      title="库存盘点"
      onClose={onClose}
      busy={busy}
      dirty={!!lines.length || !!reason}
      error={error}
      footer={
        <Button
          title="确认盘点"
          onPress={confirm}
          busy={busy}
          disabled={!lines.length}
        />
      }
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="搜索商品或条码"
      />
      {query.trim() &&
        products
          .filter((p) =>
            `${p.name} ${p.barcode}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
          .slice(0, 20)
          .map((p) => (
            <Button
              key={p.id}
              title={`添加 ${p.name}`}
              kind="secondary"
              disabled={busy || lines.some((i) => i.product_id === p.id)}
              onPress={() => {
                setLines([
                  ...lines,
                  {
                    product_id: p.id,
                    name: p.name,
                    expected_stock: p.stock,
                    counted: String(p.stock),
                  },
                ]);
                setQuery("");
              }}
            />
          ))}
      {!lines.length && (
        <Text style={s.caption}>搜索并添加需要盘点的商品。</Text>
      )}
      {lines.map((line) => (
        <Card key={line.product_id}>
          <Text style={s.subtitle}>{line.name}</Text>
          <Text style={s.caption}>
            账面 {line.expected_stock} · 差异{" "}
            {line.counted === ""
              ? "未填"
              : Number(line.counted) - line.expected_stock}
          </Text>
          <Field
            label={`${line.name} 实盘数量`}
            value={line.counted}
            onChangeText={(value) =>
              setLines(
                lines.map((i) => (i === line ? { ...i, counted: value } : i)),
              )
            }
            keyboardType="number-pad"
            editable={!busy}
          />
          <Button
            title={`移除 ${line.name}`}
            kind="secondary"
            disabled={busy}
            onPress={() => setLines(lines.filter((i) => i !== line))}
          />
        </Card>
      ))}
      <Field
        label="盘点原因"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        editable={!busy}
      />
      <Card>
        <Text style={s.subtitle}>最近库存调整（最多显示 20 条）</Text>
        {history.slice(0, 20).map((h) => (
          <View key={h.id}>
            <Text style={s.caption}>
              {h.name}：{h.before_stock} → {h.after_stock} · {h.reason} ·{" "}
              {h.created_at.slice(0, 10)}
            </Text>
          </View>
        ))}
      </Card>
    </ScreenModal>
  );
}
