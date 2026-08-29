import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  API_ORIGIN,
  AdminSession,
  Customer,
  fetchDashboardData,
  loadSession,
  clearSession,
  loginAdmin,
  Router,
  saveSession,
  SessionRejectedError,
  Transaction,
  verifySession,
  type DashboardStats,
} from '@/lib/api';
import colors from '@/constants/colors';

const logo = require('../../assets/branding/ocholasupernet-logo.png');

type Tab = 'home' | 'customers' | 'network' | 'billing' | 'settings';

type AppData = {
  stats: DashboardStats | null;
  customers: Customer[];
  routers: Router[];
  transactions: Transaction[];
};

const EMPTY_DATA: AppData = { stats: null, customers: [], routers: [], transactions: [] };

function formatMoney(value: number | undefined, currency = 'KES'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function displayDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusColor(status?: string | null): string {
  const normalized = status?.toLowerCase();
  if (normalized === 'active' || normalized === 'online' || normalized === 'completed' || normalized === 'success') {
    return colors.light.accent;
  }
  if (normalized === 'expired' || normalized === 'offline' || normalized === 'failed' || normalized === 'suspended') {
    return '#f87171';
  }
  return '#fbbf24';
}

function BrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.brandHeader}>
      <Image source={logo} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brandSubtitle}>{subtitle}</Text>
    </View>
  );
}

function LoginScreen({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Enter your username and password to continue.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const session = await loginAdmin(username, password);
      await saveSession(session);
      onSignedIn(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.light.background} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.loginContent}
          keyboardShouldPersistTaps="handled"
        >
          <BrandHeader subtitle="ISP operations, wherever you work" />
          <View style={styles.loginCard}>
            <View style={styles.eyebrowRow}>
              <View style={styles.liveDot} />
              <Text style={styles.eyebrow}>SECURE ADMIN ACCESS</Text>
            </View>
            <Text style={styles.loginTitle}>Welcome back</Text>
            <Text style={styles.loginDescription}>
              Sign in to manage your network, customers, and billing.
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={17} color="#f87171" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Username</Text>
            <View style={styles.inputWrap}>
              <Feather name="user" size={17} color={colors.light.mutedForeground} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="your-username"
                placeholderTextColor={colors.light.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                style={styles.input}
                editable={!loading}
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Feather name="lock" size={17} color={colors.light.mutedForeground} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.light.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete="password"
                style={styles.input}
                editable={!loading}
                onSubmitEditing={() => void submit()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                onPress={() => setShowPassword((current) => !current)}
                hitSlop={12}
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={17} color={colors.light.mutedForeground} />
              </Pressable>
            </View>

            <Pressable
              onPress={() => void submit()}
              disabled={loading}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, loading && styles.disabled]}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
              {!loading ? <Feather name="arrow-right" size={18} color="#fff" /> : null}
            </Pressable>

            <View style={styles.loginFooter}>
              <Feather name="shield" size={14} color={colors.light.accent} />
              <Text style={styles.footerText}>Your session is stored securely on this device</Text>
            </View>
          </View>
          <Text style={styles.versionText}>OcholaSuperNet native app · API {API_ORIGIN}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value, icon, tone = colors.light.primary }: {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: `${tone}22` }]}>
        <Feather name={icon} size={18} color={tone} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DashboardView({ session, data, onNavigate }: {
  session: AdminSession;
  data: AppData;
  onNavigate: (tab: Tab) => void;
}) {
  const currency = session.admin.currency || 'KES';
  const onlineRouters = data.routers.filter((router) => router.status === 'online' || router.status === 'connected').length;
  const activeCustomers = data.customers.filter((customer) => customer.status === 'active').length;
  const recentTransactions = data.transactions.slice(0, 4);
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.pageTop}>
        <View>
          <Text style={styles.eyebrow}>LIVE OPERATIONS</Text>
          <Text style={styles.pageTitle}>{greeting}</Text>
          <Text style={styles.pageSubtitle}>{session.admin.name || session.admin.username}</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(session.admin.name || 'A').slice(0, 1).toUpperCase()}</Text></View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroOrb} />
        <Text style={styles.heroEyebrow}>NETWORK PULSE</Text>
        <Text style={styles.heroTitle}>Your ISP at a glance</Text>
        <Text style={styles.heroCopy}>Keep your subscribers connected and your operations moving.</Text>
        <Pressable onPress={() => onNavigate('network')} style={styles.heroButton}>
          <Text style={styles.heroButtonText}>View network</Text>
          <Feather name="arrow-up-right" size={16} color={colors.light.background} />
        </Pressable>
      </View>

      <SectionTitle title="Financial pulse" action="Billing" onAction={() => onNavigate('billing')} />
      <View style={styles.metricGrid}>
        <MetricCard label="This month" value={formatMoney(data.stats?.revenueMonth, currency)} icon="trending-up" tone={colors.light.accent} />
        <MetricCard label="Customers" value={String(data.stats?.customerCount ?? activeCustomers)} icon="users" tone={colors.light.primary} />
        <MetricCard label="Online routers" value={`${data.stats?.onlineRouters ?? onlineRouters}/${data.stats?.totalRouters ?? data.routers.length}`} icon="radio" tone="#7dd3fc" />
        <MetricCard label="Active sessions" value={String(data.stats?.activeSessions ?? '—')} icon="activity" tone="#fbbf24" />
      </View>

      <SectionTitle title="Network health" action="Open network" onAction={() => onNavigate('network')} />
      <View style={styles.panel}>
        {data.routers.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="server" size={24} color={colors.light.mutedForeground} />
            <Text style={styles.emptyTitle}>No routers registered</Text>
            <Text style={styles.emptyCopy}>Connect a MikroTik router from the web admin to see live health here.</Text>
          </View>
        ) : data.routers.slice(0, 3).map((router) => (
          <View key={router.id} style={styles.listRow}>
            <View style={[styles.statusIcon, { backgroundColor: `${statusColor(router.status)}22` }]}>
              <Feather name="wifi" size={16} color={statusColor(router.status)} />
            </View>
            <View style={styles.listCopy}>
              <Text style={styles.listTitle}>{router.name}</Text>
              <Text style={styles.listSubtitle}>{router.host || router.ipAddress || router.location || 'MikroTik router'}</Text>
            </View>
            <Text style={[styles.statusText, { color: statusColor(router.status) }]}>{router.status || 'unknown'}</Text>
          </View>
        ))}
      </View>

      <SectionTitle title="Recent payments" action="All billing" onAction={() => onNavigate('billing')} />
      <View style={styles.panel}>
        {recentTransactions.length === 0 ? (
          <View style={styles.emptyStateSmall}><Text style={styles.emptyCopy}>No recent payments to show.</Text></View>
        ) : recentTransactions.map((transaction) => (
          <View key={transaction.id} style={styles.listRow}>
            <View style={[styles.statusIcon, { backgroundColor: `${colors.light.accent}22` }]}>
              <Feather name="arrow-down-left" size={16} color={colors.light.accent} />
            </View>
            <View style={styles.listCopy}>
              <Text style={styles.listTitle}>{transaction.customerName || transaction.reference || 'Customer payment'}</Text>
              <Text style={styles.listSubtitle}>{displayDate(transaction.createdAt || transaction.created_at)} · {transaction.method || transaction.payment_method || 'Payment'}</Text>
            </View>
            <Text style={styles.amountText}>{formatMoney(transaction.amount, currency)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function CustomersView({ customers, onRefresh }: { customers: Customer[]; onRefresh: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => customers.filter((customer) => {
    const haystack = `${customer.name || ''} ${customer.username || ''} ${customer.phone || ''}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [customers, query]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.light.primary} />}>
      <Text style={styles.eyebrow}>SUBSCRIBERS</Text>
      <Text style={styles.pageTitle}>Customers</Text>
      <Text style={styles.pageSubtitle}>{customers.length} accounts in your ISP</Text>
      <View style={styles.searchWrap}>
        <Feather name="search" size={17} color={colors.light.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search customers" placeholderTextColor={colors.light.mutedForeground} style={styles.searchInput} />
      </View>
      <View style={styles.filterRow}>
        <Text style={styles.filterText}>{filtered.length} results</Text>
        <View style={styles.filterChip}><Text style={styles.filterChipText}>All statuses</Text><Feather name="chevron-down" size={14} color={colors.light.mutedForeground} /></View>
      </View>
      <View style={styles.panel}>
        {filtered.length === 0 ? (
          <View style={styles.emptyState}><Feather name="users" size={24} color={colors.light.mutedForeground} /><Text style={styles.emptyTitle}>No customers found</Text><Text style={styles.emptyCopy}>Try a different search or add subscribers from the web admin.</Text></View>
        ) : filtered.map((customer) => (
          <View key={customer.id} style={styles.customerRow}>
            <View style={styles.customerAvatar}><Text style={styles.customerAvatarText}>{(customer.name || customer.username || '?').slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.listCopy}><Text style={styles.listTitle}>{customer.name || customer.username || 'Unnamed customer'}</Text><Text style={styles.listSubtitle}>{customer.username || customer.phone || customer.type || 'Subscriber'}</Text></View>
            <View style={styles.customerStatus}><View style={[styles.statusDot, { backgroundColor: statusColor(customer.status) }]} /><Text style={[styles.statusText, { color: statusColor(customer.status) }]}>{customer.status || 'unknown'}</Text></View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function NetworkView({ routers, onRefresh }: { routers: Router[]; onRefresh: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.light.primary} />}>
      <Text style={styles.eyebrow}>INFRASTRUCTURE</Text>
      <Text style={styles.pageTitle}>Network</Text>
      <Text style={styles.pageSubtitle}>MikroTik router fleet and live health</Text>
      <View style={styles.networkSummary}>
        <View><Text style={styles.summaryNumber}>{routers.filter((r) => r.status === 'online' || r.status === 'connected').length}</Text><Text style={styles.summaryLabel}>Online now</Text></View>
        <View style={styles.summaryDivider} />
        <View><Text style={styles.summaryNumber}>{routers.length}</Text><Text style={styles.summaryLabel}>Total routers</Text></View>
      </View>
      <View style={styles.panel}>
        {routers.length === 0 ? <View style={styles.emptyState}><Feather name="server" size={24} color={colors.light.mutedForeground} /><Text style={styles.emptyTitle}>No router data</Text><Text style={styles.emptyCopy}>Register your first MikroTik router from the admin web app.</Text></View> : routers.map((router) => (
            <View key={router.id} style={styles.networkRow}>
            <View style={[styles.statusIcon, { backgroundColor: `${statusColor(router.status)}22` }]}><Feather name="radio" size={17} color={statusColor(router.status)} /></View>
            <View style={styles.listCopy}><Text style={styles.listTitle}>{router.name}</Text><Text style={styles.listSubtitle}>{router.host || router.ipAddress || 'Address not provided'}{router.model ? ` · ${router.model}` : ''}</Text></View>
            <View style={styles.networkStatus}><View style={[styles.statusDot, { backgroundColor: statusColor(router.status) }]} /><Text style={[styles.statusText, { color: statusColor(router.status) }]}>{router.status || 'unknown'}</Text></View>
          </View>
        ))}
      </View>
      <View style={styles.infoBanner}><Feather name="info" size={17} color="#7dd3fc" /><Text style={styles.infoText}>Router provisioning and MikroTik changes remain protected in the admin web workflow.</Text></View>
    </ScrollView>
  );
}

function BillingView({ session, transactions, onRefresh }: { session: AdminSession; transactions: Transaction[]; onRefresh: () => void }) {
  const total = transactions.reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.light.primary} />}>
      <Text style={styles.eyebrow}>CASHFLOW</Text>
      <Text style={styles.pageTitle}>Billing</Text>
      <Text style={styles.pageSubtitle}>Payment activity for {session.admin.name || session.admin.username}</Text>
      <View style={styles.revenueCard}><Text style={styles.revenueLabel}>Loaded transaction volume</Text><Text style={styles.revenueValue}>{formatMoney(total, session.admin.currency || 'KES')}</Text><Text style={styles.revenueNote}>{transactions.length} recent transactions from the secure API</Text></View>
      <SectionTitle title="Transaction history" />
      <View style={styles.panel}>
        {transactions.length === 0 ? <View style={styles.emptyState}><Feather name="credit-card" size={24} color={colors.light.mutedForeground} /><Text style={styles.emptyTitle}>No transactions yet</Text><Text style={styles.emptyCopy}>Payment activity will appear when your API returns transactions.</Text></View> : transactions.map((transaction) => (
          <View key={transaction.id} style={styles.listRow}>
            <View style={[styles.statusIcon, { backgroundColor: `${statusColor(transaction.status)}22` }]}><Feather name="credit-card" size={16} color={statusColor(transaction.status)} /></View>
            <View style={styles.listCopy}><Text style={styles.listTitle}>{transaction.customerName || transaction.reference || 'Payment'}</Text><Text style={styles.listSubtitle}>{displayDate(transaction.createdAt || transaction.created_at)} · {transaction.method || transaction.payment_method || 'Payment'}</Text></View>
            <View style={styles.amountColumn}><Text style={styles.amountText}>{formatMoney(transaction.amount, session.admin.currency || 'KES')}</Text><Text style={[styles.statusText, { color: statusColor(transaction.status) }]}>{transaction.status || 'pending'}</Text></View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SettingsView({ session, onLogout }: { session: AdminSession; onLogout: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.pageTitle}>Settings</Text>
      <Text style={styles.pageSubtitle}>Native app and session controls</Text>
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(session.admin.name || 'A').slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.listCopy}><Text style={styles.listTitle}>{session.admin.name || session.admin.username}</Text><Text style={styles.listSubtitle}>@{session.admin.username} · {session.admin.role || 'ISP admin'}</Text></View>
      </View>
      <View style={styles.panel}>
        <View style={styles.settingRow}><Feather name="globe" size={18} color={colors.light.accent} /><View style={styles.listCopy}><Text style={styles.listTitle}>API connection</Text><Text style={styles.listSubtitle}>{API_ORIGIN}</Text></View><View style={styles.connectionPill}><View style={styles.statusDot} /><Text style={styles.connectionText}>Configured</Text></View></View>
        <View style={styles.settingRow}><Feather name="shield" size={18} color={colors.light.accent} /><View style={styles.listCopy}><Text style={styles.listTitle}>Secure session</Text><Text style={styles.listSubtitle}>Stored in device secure storage</Text></View></View>
      </View>
      <Pressable onPress={onLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}><Feather name="log-out" size={17} color="#f87171" /><Text style={styles.logoutText}>Log out</Text></Pressable>
      <Text style={styles.versionText}>OcholaSuperNet · Android, iPhone & desktop targets</Text>
    </ScrollView>
  );
}

function BottomNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const items: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'customers', label: 'Customers', icon: 'users' },
    { key: 'network', label: 'Network', icon: 'radio' },
    { key: 'billing', label: 'Billing', icon: 'credit-card' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const selected = active === item.key;
        return <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.navItem} accessibilityRole="tab" accessibilityState={{ selected }}><Feather name={item.icon} size={20} color={selected ? colors.light.primary : colors.light.mutedForeground} /><Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text></Pressable>;
      })}
    </View>
  );
}

function AdminApp({ session, onLogout }: { session: AdminSession; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const nextData = await fetchDashboardData(session);
      setData(nextData);
    } catch (reason) {
      if (reason instanceof SessionRejectedError) {
        await clearSession();
        onLogout();
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Could not load live data.');
    } finally {
      setLoading(false);
    }
  }, [onLogout, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const page = activeTab === 'home'
    ? <DashboardView session={session} data={data} onNavigate={setActiveTab} />
    : activeTab === 'customers'
      ? <CustomersView customers={data.customers} onRefresh={() => void refresh()} />
      : activeTab === 'network'
        ? <NetworkView routers={data.routers} onRefresh={() => void refresh()} />
        : activeTab === 'billing'
          ? <BillingView session={session} transactions={data.transactions} onRefresh={() => void refresh()} />
          : <SettingsView session={session} onLogout={() => { void clearSession(); onLogout(); }} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.light.background} />
      <View style={styles.appShell}>
        {loading ? <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={colors.light.primary} /><Text style={styles.loadingText}>Loading your ISP workspace…</Text></View> : null}
        {error ? <Pressable onPress={() => void refresh()} style={styles.dataError}><Feather name="alert-triangle" size={16} color="#fbbf24" /><Text style={styles.dataErrorText}>{error} Tap to retry.</Text></Pressable> : null}
        {page}
        <BottomNav active={activeTab} onChange={setActiveTab} />
      </View>
    </SafeAreaView>
  );
}

export default function HomeScreen() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void (async () => {
      const stored = await loadSession();
      if (!stored) {
        setRestoring(false);
        return;
      }
      try {
        const admin = await verifySession(stored.token);
        setSession({ token: stored.token, admin });
      } catch (reason) {
        if (reason instanceof SessionRejectedError) await clearSession();
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  if (restoring) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.restoreScreen}><Image source={logo} style={styles.restoreLogo} resizeMode="contain" /><ActivityIndicator color={colors.light.primary} /><Text style={styles.loadingText}>Restoring secure session…</Text></View></SafeAreaView>;
  }
  if (!session) return <LoginScreen onSignedIn={setSession} />;
  return <AdminApp session={session} onLogout={() => setSession(null)} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.light.background },
  appShell: { flex: 1 },
  restoreScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  restoreLogo: { width: 280, height: 190 },
  brandHeader: { alignItems: 'center', marginBottom: 18 },
  logo: { width: 300, height: 196 },
  brandSubtitle: { color: colors.light.mutedForeground, fontFamily: 'DMSans_500Medium', fontSize: 14, marginTop: -18 },
  loginContent: { flexGrow: 1, justifyContent: 'center', padding: 24, maxWidth: 620, width: '100%', alignSelf: 'center' },
  loginCard: { backgroundColor: colors.light.card, borderColor: colors.light.border, borderWidth: 1, borderRadius: 20, padding: 22, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  liveDot: { width: 7, height: 7, borderRadius: 5, backgroundColor: colors.light.accent },
  eyebrow: { color: colors.light.accent, fontFamily: 'DMSans_700Bold', fontSize: 11, letterSpacing: 1.4 },
  loginTitle: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 30, letterSpacing: -0.6 },
  loginDescription: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 22 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: '#ef444414', borderWidth: 1, borderColor: '#ef444433', borderRadius: 12, padding: 12, marginBottom: 18 },
  errorText: { color: '#fca5a5', flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 19 },
  label: { color: colors.light.foreground, fontFamily: 'DMSans_600SemiBold', fontSize: 13, marginBottom: 7, marginTop: 10 },
  inputWrap: { alignItems: 'center', backgroundColor: '#0b1d1f', borderColor: colors.light.input, borderWidth: 1, borderRadius: 11, flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 14 },
  input: { color: colors.light.foreground, flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 15, paddingVertical: 12 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.light.primary, borderRadius: 11, flexDirection: 'row', gap: 9, justifyContent: 'center', marginTop: 24, minHeight: 52 },
  primaryButtonText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
  loginFooter: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 22 },
  footerText: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 11 },
  versionText: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 20, textAlign: 'center' },
  scrollContent: { paddingBottom: 110, paddingHorizontal: 18, paddingTop: 22, width: '100%', maxWidth: 900, alignSelf: 'center' },
  pageTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  pageTitle: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 29, letterSpacing: -0.6, marginTop: 4 },
  pageSubtitle: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 14, marginTop: 4 },
  avatar: { alignItems: 'center', backgroundColor: colors.light.primary, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  avatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 17 },
  heroCard: { backgroundColor: '#102426', borderColor: colors.light.border, borderWidth: 1, borderRadius: 18, marginBottom: 24, overflow: 'hidden', padding: 20, position: 'relative' },
  heroOrb: { backgroundColor: '#e47b461a', borderRadius: 150, height: 240, position: 'absolute', right: -75, top: -100, width: 240 },
  heroEyebrow: { color: colors.light.accent, fontFamily: 'DMSans_700Bold', fontSize: 11, letterSpacing: 1.3 },
  heroTitle: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 23, marginTop: 10 },
  heroCopy: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 300 },
  heroButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.light.primary, borderRadius: 9, flexDirection: 'row', gap: 7, marginTop: 18, paddingHorizontal: 14, paddingVertical: 10 },
  heroButtonText: { color: colors.light.background, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11, marginTop: 2 },
  sectionTitle: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 17 },
  sectionAction: { color: colors.light.primary, fontFamily: 'DMSans_600SemiBold', fontSize: 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  metricCard: { backgroundColor: colors.light.card, borderColor: colors.light.border, borderRadius: 14, borderWidth: 1, flexBasis: '47%', flexGrow: 1, minWidth: 140, padding: 14 },
  metricIcon: { alignItems: 'center', borderRadius: 9, height: 34, justifyContent: 'center', marginBottom: 12, width: 34 },
  metricValue: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 19 },
  metricLabel: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 12, marginTop: 3 },
  panel: { backgroundColor: colors.light.card, borderColor: colors.light.border, borderRadius: 14, borderWidth: 1, marginBottom: 24, overflow: 'hidden', paddingHorizontal: 14 },
  listRow: { alignItems: 'center', borderBottomColor: colors.light.border, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 70, paddingVertical: 11 },
  statusIcon: { alignItems: 'center', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  listCopy: { flex: 1 },
  listTitle: { color: colors.light.foreground, fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  listSubtitle: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 4 },
  statusText: { fontFamily: 'DMSans_600SemiBold', fontSize: 11, textTransform: 'capitalize' },
  amountText: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  emptyState: { alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 30 },
  emptyStateSmall: { alignItems: 'center', paddingVertical: 20 },
  emptyTitle: { color: colors.light.foreground, fontFamily: 'DMSans_600SemiBold', fontSize: 14, textAlign: 'center' },
  emptyCopy: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, maxWidth: 300, textAlign: 'center' },
  searchWrap: { alignItems: 'center', backgroundColor: colors.light.card, borderColor: colors.light.border, borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 9, marginTop: 20, paddingHorizontal: 13 },
  searchInput: { color: colors.light.foreground, flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, paddingVertical: 13 },
  filterRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11, marginTop: 16 },
  filterText: { color: colors.light.mutedForeground, fontFamily: 'DMSans_500Medium', fontSize: 12 },
  filterChip: { alignItems: 'center', borderColor: colors.light.border, borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  filterChipText: { color: colors.light.mutedForeground, fontFamily: 'DMSans_500Medium', fontSize: 11 },
  customerRow: { alignItems: 'center', borderBottomColor: colors.light.border, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 72 },
  customerAvatar: { alignItems: 'center', backgroundColor: '#d9683530', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  customerAvatarText: { color: colors.light.primary, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  customerStatus: { alignItems: 'flex-end', gap: 5 },
  statusDot: { backgroundColor: colors.light.accent, borderRadius: 5, height: 7, width: 7 },
  networkSummary: { alignItems: 'center', backgroundColor: colors.light.card, borderColor: colors.light.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', marginVertical: 20, paddingVertical: 17 },
  summaryNumber: { color: colors.light.foreground, fontFamily: 'DMSans_700Bold', fontSize: 24, textAlign: 'center' },
  summaryLabel: { color: colors.light.mutedForeground, fontFamily: 'DMSans_400Regular', fontSize: 12, marginTop: 3, textAlign: 'center' },
  summaryDivider: { backgroundColor: colors.light.border, height: 38, width: 1 },
  networkRow: { alignItems: 'center', borderBottomColor: colors.light.border, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 76 },
  networkStatus: { alignItems: 'flex-end', gap: 5 },
  infoBanner: { alignItems: 'flex-start', backgroundColor: '#7dd3fc14', borderColor: '#7dd3fc33', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 13 },
  infoText: { color: '#bae6fd', flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18 },
  revenueCard: { backgroundColor: colors.light.primary, borderRadius: 16, marginBottom: 26, padding: 20 },
  revenueLabel: { color: '#fff9', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  revenueValue: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 30, marginTop: 7 },
  revenueNote: { color: '#fff9', fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 5 },
  amountColumn: { alignItems: 'flex-end', gap: 4 },
  profileCard: { alignItems: 'center', backgroundColor: colors.light.card, borderColor: colors.light.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 13, marginVertical: 20, padding: 16 },
  profileAvatar: { alignItems: 'center', backgroundColor: colors.light.primary, borderRadius: 25, height: 50, justifyContent: 'center', width: 50 },
  profileAvatarText: { color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 21 },
  settingRow: { alignItems: 'center', borderBottomColor: colors.light.border, borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 73 },
  connectionPill: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  connectionText: { color: colors.light.accent, fontFamily: 'DMSans_600SemiBold', fontSize: 10 },
  logoutButton: { alignItems: 'center', borderColor: '#f8717138', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 2, minHeight: 48 },
  logoutText: { color: '#f87171', fontFamily: 'DMSans_600SemiBold', fontSize: 14 },
  bottomNav: { backgroundColor: '#0b1d1ff2', borderTopColor: colors.light.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, paddingBottom: Platform.OS === 'ios' ? 8 : 4, paddingTop: 8, position: 'absolute', right: 0 },
  navItem: { alignItems: 'center', gap: 4, minWidth: 56, paddingHorizontal: 3, paddingVertical: 3 },
  navLabel: { color: colors.light.mutedForeground, fontFamily: 'DMSans_500Medium', fontSize: 10 },
  navLabelActive: { color: colors.light.primary, fontFamily: 'DMSans_700Bold' },
  loadingOverlay: { alignItems: 'center', backgroundColor: '#081416ee', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 4, gap: 12 },
  loadingText: { color: colors.light.mutedForeground, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  dataError: { alignItems: 'center', backgroundColor: '#fbbf2414', borderBottomColor: '#fbbf2433', borderBottomWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 17, paddingVertical: 10 },
  dataErrorText: { color: '#fcd34d', flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 12 },
});