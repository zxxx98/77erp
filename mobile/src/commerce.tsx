import React, { useEffect, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import { api } from "./native";
import { Contact, Draft, Order, orderLabel } from "./model";
import {
  Button,
  Card,
  Chips,
  Field,
  ScreenModal,
  SearchField,
  s,
  useSubmitLock,
} from "./ui";
const cash = (n: number) => `¥ ${(n / 100).toFixed(2)}`;
const paymentLabel: Record<string, string> = {
  unverified: "待核对",
  unpaid: "未收付",
  partial: "部分收付",
  paid: "已结清",
  void: "已作废",
};
function useBusiness() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useSubmitLock(),
    request = useRef({ key: "", id: "" });
  const run = async (fn: () => Promise<void>) => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.leave();
      setBusy(false);
    }
  };
  const send = async <T,>(path: string, body: object): Promise<T> => {
    const key = JSON.stringify([path, body]);
    if (request.current.key !== key)
      request.current = {
        key,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      };
    const id = request.current.id;
    const result = await api<T>(path, "POST", { ...body, request_id: id });
    if (request.current.id === id) request.current = { key: "", id: "" };
    return result;
  };
  return { busy, error, setError, run, send };
}
export function CommerceScreen({
  onClose,
  onResume,
  onRefresh,
}: {
  onClose: () => void;
  onResume: (draft: Draft) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState("contacts");
  return (
    <ScreenModal title="往来与财务" onClose={onClose}>
      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { id: "contacts", label: "往来单位" },
          { id: "drafts", label: "草稿" },
          { id: "finance", label: "收付款" },
          { id: "profit", label: "毛利" },
        ]}
      />
      {tab === "contacts" && <Contacts onRefresh={onRefresh} />}
      {tab === "drafts" && <DraftList onResume={onResume} />}
      {tab === "finance" && <Finance />}
      {tab === "profit" && <Profit />}
    </ScreenModal>
  );
}
function Contacts({ onRefresh }: { onRefresh: () => void }) {
  const empty: Contact = {
    role: "supplier",
    name: "",
    person: "",
    phone: "",
    address: "",
    note: "",
    active: 1,
  };
  const [rows, setRows] = useState<Contact[]>([]),
    [form, setForm] = useState<Contact>(empty),
    [query, setQuery] = useState("");
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setRows(await api<Contact[]>("/contacts"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="搜索往来单位、联系人或电话"
      />
      {rows
        .filter((c) => `${c.name} ${c.person} ${c.phone}`.includes(query))
        .slice(0, 50)
        .map((c) => (
          <Button
            key={c.id}
            title={`${c.role === "supplier" ? "供应商" : "客户"} · ${c.name}${!c.active ? "（已停用）" : ""}`}
            kind="secondary"
            disabled={busy}
            onPress={() => setForm(c)}
          />
        ))}
      <Text style={s.caption}>
        最多显示 50 条，请搜索定位。历史单据名称不会随编辑变化。
      </Text>
      <Button
        title="新增往来单位"
        kind="secondary"
        disabled={busy}
        onPress={() => setForm(empty)}
      />
      <Card>
        {!form.id && (
          <Chips
            value={form.role}
            onChange={(value) => {
              if (!busy) setForm({ ...form, role: value as Contact["role"] });
            }}
            options={[
              { id: "supplier", label: "供应商" },
              { id: "customer", label: "客户" },
            ]}
          />
        )}
        {(
          [
            ["name", "单位名称", 100],
            ["person", "联系人", 100],
            ["phone", "联系电话", 50],
            ["address", "地址", 300],
            ["note", "往来备注", 500],
          ] as const
        ).map(([key, label, max]) => (
          <Field
            key={key}
            label={label}
            value={form[key]}
            maxLength={max}
            editable={!busy}
            onChangeText={(value) => setForm({ ...form, [key]: value })}
          />
        ))}
        <Button
          title={form.active ? "当前启用 · 点击停用" : "当前停用 · 点击启用"}
          kind="secondary"
          disabled={busy}
          onPress={() => setForm({ ...form, active: form.active ? 0 : 1 })}
        />
        <Button
          title="保存往来单位"
          busy={busy}
          onPress={() =>
            void run(async () => {
              await send("/contacts", form);
              setForm(empty);
              await load();
              onRefresh();
            })
          }
        />
      </Card>
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </>
  );
}
export function DraftList({ onResume }: { onResume: (draft: Draft) => void }) {
  const [rows, setRows] = useState<Draft[]>([]);
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () => setRows(await api<Draft[]>("/drafts"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <Text style={s.caption}>保存的草稿可跨设备继续，不影响库存。</Text>
      {!rows.length && <Text style={s.caption}>暂无草稿</Text>}
      {rows.map((d) => (
        <Card key={d.id}>
          <Text style={s.subtitle}>
            {d.type === "in" ? "采购" : "销售"} · {d.partner || "未填往来单位"}
          </Text>
          <Text style={s.caption}>
            {d.items.length} 种商品 · {d.updated_at}
          </Text>
          <Button
            title={`继续草稿 #${d.id}`}
            disabled={busy}
            onPress={() => onResume(d)}
          />
          <Button
            title={`删除草稿 #${d.id}`}
            kind="danger"
            disabled={busy}
            onPress={() =>
              Alert.alert("删除草稿？", "不会影响库存。", [
                { text: "取消", style: "cancel" },
                {
                  text: "确认删除",
                  style: "destructive",
                  onPress: () =>
                    void run(async () => {
                      await send(`/drafts/${d.id}/discard`, {
                        version: d.version,
                      });
                      await load();
                    }),
                },
              ])
            }
          />
        </Card>
      ))}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </>
  );
}
type PaymentData = {
  paid_cents: number;
  due_cents: number;
  payment_status: string;
  direction: string;
  total: number;
  entries: {
    id: number;
    amount_cents: number;
    method: string;
    note: string;
    created_at: string;
    reversed_at: string | null;
    reverse_reason: string;
  }[];
};
export function PaymentEditor({
  order,
  onChanged,
}: {
  order: Order;
  onChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<PaymentData | null>(null),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("银行转账"),
    [note, setNote] = useState(""),
    [reason, setReason] = useState("");
  const { busy, error, setError, run, send } = useBusiness();
  const load = async () =>
    setData(await api<PaymentData>(`/orders/${order.id}/payments`));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [order.id]);
  const changed = async () => {
    await load();
    await onChanged?.();
  };
  const confirm = () => {
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setError("请填写有效金额，最多两位小数。");
      return;
    }
    Alert.alert(
      data?.payment_status === "unverified"
        ? "核对历史收付款？"
        : "登记收付款？",
      "仅记录资金流水，请确认金额与实际一致。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认登记",
          onPress: () =>
            void run(async () => {
              await send(
                `/orders/${order.id}/${data?.payment_status === "unverified" ? "settlement" : "payments"}`,
                data?.payment_status === "unverified"
                  ? {
                      paid: Number(amount),
                      note,
                      confirmation: "TRACK_SETTLEMENT",
                    }
                  : { amount: Number(amount), method, note },
              );
              setAmount("");
              await changed();
            }),
        },
      ],
    );
  };
  return (
    <Card>
      <Text style={s.subtitle}>收付款记录</Text>
      {data && (
        <>
          <Text style={s.body}>
            {data.direction === "receive" ? "应收" : "应付"}{" "}
            {cash(Math.round(data.total * 100))} · 已登记{" "}
            {cash(data.paid_cents)} · {paymentLabel[data.payment_status]}
            {data.payment_status !== "unverified"
              ? ` · 待收付 ${cash(data.due_cents)}`
              : ""}
          </Text>
          {order.status !== "void" &&
            (data.payment_status === "unverified" || data.due_cents > 0) && (
              <>
                <Field
                  label={
                    data.payment_status === "unverified"
                      ? "历史已收付金额"
                      : "本次收付款金额"
                  }
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  editable={!busy}
                />
                <Field
                  label="收付款方式"
                  value={method}
                  onChangeText={setMethod}
                  maxLength={50}
                  editable={!busy}
                />
                <Field
                  label="收付款说明"
                  value={note}
                  onChangeText={setNote}
                  maxLength={500}
                  editable={!busy}
                />
                <Button
                  title={
                    data.payment_status === "unverified"
                      ? "确认历史收付"
                      : "登记收付款"
                  }
                  busy={busy}
                  onPress={confirm}
                />
              </>
            )}
          <Text style={s.caption}>
            退货单单独登记退款，不自动冲抵原单欠款。撤销登记不代表实际退款。
          </Text>
          <Field
            label="撤销登记原因"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
            editable={!busy}
          />
          {data.entries.map((p) => (
            <Card key={p.id}>
              <Text style={s.caption}>
                {cash(p.amount_cents)} · {p.method} · {p.note} · {p.created_at}
                {p.reversed_at ? ` · 已撤销：${p.reverse_reason}` : ""}
              </Text>
              {!p.reversed_at && (
                <Button
                  title={`撤销登记 #${p.id}`}
                  kind="danger"
                  disabled={busy}
                  onPress={() => {
                    if (!reason.trim()) {
                      setError("请先填写撤销登记原因。");
                      return;
                    }
                    Alert.alert(
                      "撤销登记？",
                      "仅撤销账本记录，不执行实际退款。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "确认撤销",
                          style: "destructive",
                          onPress: () =>
                            void run(async () => {
                              await send(`/payments/${p.id}/reverse`, {
                                reason,
                              });
                              await changed();
                            }),
                        },
                      ],
                    );
                  }}
                />
              )}
            </Card>
          ))}
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </Card>
  );
}
type FinanceData = {
  orders: (Order & { payment_status: string })[];
  balances: {
    partner_id: number | null;
    name: string;
    receivable_cents: number;
    payable_cents: number;
    unverified: number;
  }[];
};
function Finance() {
  const [data, setData] = useState<FinanceData | null>(null),
    [selected, setSelected] = useState<Order | null>(null),
    [query, setQuery] = useState("");
  const { error, setError } = useBusiness();
  const load = async () => setData(await api<FinanceData>("/finance"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <Text style={s.caption}>
        历史待核对单据不计入欠款，退货退款与原单分开记录。
      </Text>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="搜索单位或单据号"
      />
      {data?.balances
        .filter((b) => b.name.includes(query))
        .map((b, i) => (
          <Card key={i}>
            <Text style={s.subtitle}>{b.name}</Text>
            <Text style={s.caption}>
              应收未收 {cash(b.receivable_cents)} · 应付未付{" "}
              {cash(b.payable_cents)} · 待核对 {b.unverified} 张
            </Text>
          </Card>
        ))}
      {data?.orders
        .filter((o) => `${o.number} ${o.partner}`.includes(query))
        .slice(0, 50)
        .map((o) => (
          <Button
            key={o.id}
            title={`${o.number} · ${o.partner} · ${paymentLabel[o.payment_status]}`}
            kind="secondary"
            onPress={() => setSelected(o)}
          />
        ))}
      <Text style={s.caption}>最多显示 50 张单据，请搜索定位。</Text>
      {selected && (
        <>
          <Text style={s.subtitle}>
            {orderLabel(selected)} · {selected.number}
          </Text>
          <PaymentEditor key={selected.id} order={selected} onChanged={load} />
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </>
  );
}
type ProfitData = {
  inventory_value_cents: number;
  totals: {
    revenue_cents: number;
    cost_cents: number;
    gross_profit_cents: number;
    unknown_revenue_cents: number;
    unknown_lines: number;
  };
  rows: {
    product_id: number;
    name: string;
    quantity: number;
    revenue_cents: number;
    cost_cents: number;
    gross_profit_cents: number;
    margin: number | null;
    unknown_lines: number;
  }[];
};
function Profit() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [data, setData] = useState<ProfitData | null>(null);
  const { busy, error, run } = useBusiness();
  const load = () =>
    run(async () =>
      setData(
        await api<ProfitData>(
          `/reports/profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      ),
    );
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Text style={s.caption}>
        移动加权平均成本；旧库存以升级时采购价估算期初成本，旧单据成本未知，不补算毛利。毛利不含税费、运费和经营费用。退货按退货日冲减，日期按
        UTC。
      </Text>
      <Field
        label="开始日期（YYYY-MM-DD）"
        value={from}
        onChangeText={setFrom}
        editable={!busy}
      />
      <Field
        label="结束日期（YYYY-MM-DD）"
        value={to}
        onChangeText={setTo}
        editable={!busy}
      />
      <Button title="查询毛利" busy={busy} onPress={() => void load()} />
      {data && (
        <>
          <Card>
            <Text style={s.body}>
              销售净额 {cash(data.totals.revenue_cents)} · 已知成本{" "}
              {cash(data.totals.cost_cents)} · 已知毛利{" "}
              {cash(data.totals.gross_profit_cents)}
            </Text>
            <Text style={s.caption}>
              成本未知净额 {cash(data.totals.unknown_revenue_cents)}（
              {data.totals.unknown_lines} 条） · 当前库存成本{" "}
              {cash(data.inventory_value_cents)}
            </Text>
          </Card>
          {data.rows.map((r) => (
            <Card key={r.product_id}>
              <Text style={s.subtitle}>{r.name}</Text>
              <Text style={s.caption}>
                净销量 {r.quantity} · 销售 {cash(r.revenue_cents)} · 成本{" "}
                {cash(r.cost_cents)} · 毛利 {cash(r.gross_profit_cents)} ·
                毛利率{" "}
                {r.margin === null ? "—" : `${(r.margin * 100).toFixed(2)}%`} ·
                未知成本 {r.unknown_lines} 条
              </Text>
            </Card>
          ))}
        </>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </>
  );
}
