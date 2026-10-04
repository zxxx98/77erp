import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Box,
  History,
  LayoutDashboard,
  ScanLine,
  Settings,
  Warehouse,
} from "lucide-react-native";
import { api, device, onUnauthorized } from "./native";
import { AuthState, Draft, Order, Product, Workspace } from "./model";
import { CommerceScreen } from "./commerce";
import { StocktakeEditor } from "./operations";
import { OrderEditor, ProductEditor, SettingsEditor } from "./forms";
import {
  AuthScreen,
  Dashboard,
  MoreScreen,
  OrderDetail,
  OrdersScreen,
  ProductDetail,
  ProductsScreen,
  ScannerScreen,
  ServerScreen,
} from "./screens";
import {
  Button,
  colors,
  ErrorNotice,
  IconButton,
  KeyboardSafeArea,
  s,
} from "./ui";
import { useKeyboardVisible } from "./layout";
import { useAppUpdate } from "./updates";

type Tab = "home" | "products" | "inventory" | "orders" | "more";
type ModalState =
  | { kind: "product"; product: Product }
  | { kind: "productEditor"; product?: Product }
  | { kind: "orderEditor"; type: "in" | "out"; product?: Product; draft?: Draft }
  | { kind: "order"; order: Order }
  | { kind: "scanner" }
  | { kind: "commerce" }
  | { kind: "stocktake" }
  | { kind: "settings" };
const tabs = [
  { id: "home" as const, title: "工作台", icon: LayoutDashboard },
  { id: "products" as const, title: "商品", icon: Box },
  { id: "inventory" as const, title: "库存", icon: Warehouse },
  { id: "orders" as const, title: "单据", icon: History },
  { id: "more" as const, title: "更多", icon: Settings },
];
function Page({
  children,
  refresh,
  refreshing = false,
}: React.PropsWithChildren<{ refresh?: () => void; refreshing?: boolean }>) {
  return (
    <ScrollView
      style={s.fill}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[s.content, s.pageContent]}
      refreshControl={
        refresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.blue}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function AppContent() {
  useAppUpdate();
  const keyboardVisible = useKeyboardVisible();
  const [server, setServer] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [booting, setBooting] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState("");
  const generation = useRef(0);
  const connectLock = useRef(false);

  const refreshAuth = useCallback(async () => {
    const current = generation.current;
    setError("");
    try {
      const result = await api<AuthState>("/auth/status");
      if (current === generation.current) setAuth(result);
    } catch (e) {
      if (current === generation.current) {
        setError((e as Error).message);
        setShowServer(true);
      }
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    device
      .getServer()
      .then((address) => {
        if (!active) return;
        setServer(address);
        if (address) void refreshAuth();
        else {
          setShowServer(true);
          setBooting(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("无法读取服务器设置，请重新填写。");
          setShowServer(true);
          setBooting(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshAuth]);
  useEffect(
    () =>
      onUnauthorized(() => {
        generation.current++;
        setAuth({ initialized: true, authenticated: false });
        setData(null);
        setModal(null);
        setRefreshing(false);
        setNotice("登录已失效，请重新登录。");
        setError("");
      }),
    [],
  );
  const refresh = useCallback(async () => {
    const current = generation.current;
    setRefreshing(true);
    setError("");
    try {
      const workspace = await api<Workspace>("/data");
      if (
        !Array.isArray(workspace.products) ||
        !Array.isArray(workspace.orders) ||
        !workspace.settings
      )
        throw new Error("服务器数据格式不正确。");
      if (current === generation.current) setData(workspace);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    if (auth?.authenticated) void refresh();
  }, [auth?.authenticated, refresh]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && auth?.authenticated && !showServer && !modal)
        void refresh();
    });
    return () => subscription.remove();
  }, [auth?.authenticated, showServer, modal, refresh]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (showServer && auth?.authenticated && !connecting) {
          setShowServer(false);
          setError("");
          return true;
        }
        if (!modal && tab !== "home" && auth?.authenticated) {
          setTab("home");
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [showServer, auth?.authenticated, tab, modal, connecting]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const connect = async (address: string) => {
    if (connectLock.current) return;
    connectLock.current = true;
    setConnecting(true);
    setError("");
    try {
      const normalized = await device.setServer(address);
      generation.current++;
      setServer(normalized);
      setAuth(null);
      setData(null);
      setModal(null);
      setNotice("");
      setTab("home");
      setShowServer(false);
      setBooting(true);
      await refreshAuth();
    } catch (e) {
      setError((e as Error).message);
      setShowServer(true);
    } finally {
      setConnecting(false);
      connectLock.current = false;
    }
  };
  const saved = (message: string) => {
    setModal(null);
    setToast(message);
    void refresh();
  };
  const openOrder = (type: "in" | "out", product?: Product) =>
    setModal({ kind: "orderEditor", type, product });
  const changeServer = () =>
    Alert.alert(
      "切换服务器？",
      "新服务器使用独立账号和库存。连接后将清除当前本机会话。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "打开连接设置",
          onPress: () => {
            setError("");
            setShowServer(true);
          },
        },
      ],
    );
  const logout = async () => {
    setLoggingOut(true);
    let message = "已退出登录。";
    try {
      await api("/auth/logout", "POST");
    } catch {
      message = "本机已退出，服务器会话将在到期后失效。";
    } finally {
      await device.clearSession();
      generation.current++;
      setAuth({ initialized: true, authenticated: false });
      setData(null);
      setModal(null);
      setLoggingOut(false);
      setTab("home");
      setNotice(message);
    }
  };

  // Sync failures belong in the page's scroll area, especially with large text.
  const syncNotice = error ? (
    <View style={{ gap: 12 }}>
      <ErrorNotice message={error} />
      <Button
        title="重新同步"
        kind="secondary"
        busy={refreshing}
        onPress={() => void refresh()}
      />
    </View>
  ) : null;

  let body;
  if (showServer)
    body = (
      <Page>
        <ServerScreen
          key={server}
          initial={server}
          busy={connecting}
          error={error}
          onConnect={connect}
          onCancel={
            auth
              ? () => {
                  setShowServer(false);
                  setError("");
                }
              : undefined
          }
        />
      </Page>
    );
  else if (booting || !auth)
    body = (
      <ScrollView contentContainerStyle={styles.loading}>
        <ActivityIndicator size="large" color={colors.blue} />
        <Text style={s.caption}>正在连接工作空间…</Text>
      </ScrollView>
    );
  else if (!auth.authenticated)
    body = (
      <Page>
        <AuthScreen
          key={String(auth.initialized)}
          auth={auth}
          server={server}
          notice={notice}
          onSuccess={(next) => {
            setAuth(next);
            setNotice("");
            setError("");
          }}
          onRefresh={() => void refreshAuth()}
          onServer={() => {
            setError("");
            setShowServer(true);
          }}
        />
      </Page>
    );
  else if (!data)
    body = (
      <ScrollView contentContainerStyle={styles.loading}>
        {refreshing ? (
          <>
            <ActivityIndicator size="large" color={colors.blue} />
            <Text style={s.caption}>正在读取库存…</Text>
          </>
        ) : (
          <>
            <ErrorNotice message={error} />
            <Button title="重新加载" onPress={() => void refresh()} />
            <Button title="连接设置" kind="secondary" onPress={changeServer} />
          </>
        )}
      </ScrollView>
    );
  else
    body = (
      <>
        <View style={s.header}>
          <Text allowFontScaling={false} style={styles.wordmark}>
            77 <Text style={{ color: colors.blue }}>ERP</Text>
          </Text>
          <Text numberOfLines={1} style={[s.caption, s.grow]}>
            {data.settings.warehouse_name}
          </Text>
          <IconButton
            icon={ScanLine}
            label="打开扫码工作台"
            onPress={() => setModal({ kind: "scanner" })}
          />
        </View>
        {tab === "home" && (
          <Page refresh={() => void refresh()} refreshing={refreshing}>
            {syncNotice}
            <Dashboard
              data={data}
              openOrder={openOrder}
              openScanner={() => setModal({ kind: "scanner" })}
              openProduct={(product) => setModal({ kind: "product", product })}
              openHistory={() => setTab("orders")}
            />
          </Page>
        )}
        {(tab === "products" || tab === "inventory") && (
          <ProductsScreen
            key={tab}
            products={data.products}
            inventory={tab === "inventory"}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            openProduct={(product) => setModal({ kind: "product", product })}
            addProduct={() => setModal({ kind: "productEditor" })}
            notice={syncNotice}
          />
        )}
        {tab === "orders" && (
          <OrdersScreen
            orders={data.orders}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onDetail={(order) => setModal({ kind: "order", order })}
            openOrder={openOrder}
            notice={syncNotice}
          />
        )}
        {tab === "more" && (
          <Page>
            {syncNotice}
            <MoreScreen
              username={auth.username}
              server={server}
              data={data}
              busy={loggingOut}
              settings={() => setModal({ kind: "settings" })}
              stocktake={() => setModal({ kind: "stocktake" })}
              commerce={() => setModal({ kind: "commerce" })}
              changeServer={changeServer}
              logout={() =>
                Alert.alert("退出登录？", "下次打开需要重新登录。", [
                  { text: "取消", style: "cancel" },
                  {
                    text: "退出登录",
                    style: "destructive",
                    onPress: () => void logout(),
                  },
                ])
              }
            />
          </Page>
        )}
        {!!toast && (
          <View accessibilityRole="alert" style={styles.toast}>
            <Text style={{ color: colors.white }}>{toast}</Text>
          </View>
        )}
        {!keyboardVisible && (
          <View style={styles.tabs}>
            {tabs.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityLabel={item.title}
                accessibilityState={{ selected: tab === item.id }}
                onPress={() => setTab(item.id)}
                style={styles.tab}
              >
                <item.icon
                  size={23}
                  color={tab === item.id ? colors.blue : colors.muted}
                />
                <Text
                  style={{
                    color: tab === item.id ? colors.blue : colors.muted,
                    fontSize: 12,
                    fontWeight: tab === item.id ? "600" : "400",
                    textAlign: "center",
                  }}
                >
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {modal?.kind === "product" && (
          <ProductDetail
            product={
              data.products.find(
                (product) => product.id === modal.product.id,
              ) ?? modal.product
            }
            onClose={() => setModal(null)}
            edit={() =>
              setModal({ kind: "productEditor", product: modal.product })
            }
            openOrder={openOrder}
          />
        )}
        {modal?.kind === "productEditor" && (
          <ProductEditor
            product={modal.product}
            onClose={() => setModal(null)}
            onSaved={saved}
          />
        )}
        {modal?.kind === "orderEditor" && (
          <OrderEditor
            type={modal.type}
            initialProduct={modal.product}
            initialDraft={modal.draft}
            contacts={data.contacts || []}
            products={data.products}
            onClose={() => setModal(null)}
            onSaved={saved}
          />
        )}
        {modal?.kind === "order" && (
          <OrderDetail order={modal.order} onClose={() => setModal(null)} onSaved={saved} />
        )}
        {modal?.kind === "scanner" && (
          <ScannerScreen
            products={data.products}
            onClose={() => setModal(null)}
            openOrder={openOrder}
          />
        )}
        {modal?.kind === "commerce" && <CommerceScreen onClose={() => setModal(null)} onRefresh={() => void refresh()} onResume={draft => setModal({kind:"orderEditor",type:draft.type,draft})} />}
        {modal?.kind === "stocktake" && <StocktakeEditor products={data.products} onClose={() => setModal(null)} onSaved={saved} />}
        {modal?.kind === "settings" && (
          <SettingsEditor
            settings={data.settings}
            server={server}
            onClose={() => setModal(null)}
            onSaved={saved}
          />
        )}
      </>
    );
  return (
    <KeyboardSafeArea>
      <StatusBar barStyle="dark-content" />
      {body}
    </KeyboardSafeArea>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  loading: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    padding: 28,
  },
  wordmark: {
    fontSize: 23,
    fontWeight: "800",
    color: colors.text,
    paddingHorizontal: 7,
  },
  tabs: {
    flexShrink: 0,
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderColor: colors.border,
    minHeight: 66,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  toast: {
    marginHorizontal: 20,
    marginVertical: 8,
    padding: 16,
    backgroundColor: colors.text,
    borderRadius: 10,
  },
});
