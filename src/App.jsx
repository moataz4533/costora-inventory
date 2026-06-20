import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { 
  Package, ArrowRightLeft, Store, History, FileText,
  AlertCircle, Settings, ListPlus, Building2, Trash2, LayoutDashboard,
  ClipboardCheck, TrendingUp, AlertTriangle, ChevronDown, Download, X, RefreshCw, LogOut
} from 'lucide-react';

// ==========================================
// 🔐 إعدادات Supabase 
// ==========================================
const supabaseUrl = 'https://qxikwycygpxoqtxcnwiq.supabase.co';
const supabaseKey = 'sb_publishable_VJSMTH_X98CcOLjSaXZpTw_tD85qj0d';

const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// 🧠 طبقة قاعدة البيانات
// ==========================================
const getRestId = () => localStorage.getItem('costora_inv_restaurant_id');

const DB = {
  async getSettings() {
    const id = getRestId();
    if (!id) return null;
    return { businessName: localStorage.getItem('costora_inv_restaurant_name') };
  },

  async getBranches() {
    const { data } = await supabase.from('branches').select('*').eq('restaurant_id', getRestId()).order('created_at', { ascending: true });
    return data || [];
  },
  
  async addBranch(name) {
    const { data } = await supabase.from('branches').insert({ name, restaurant_id: getRestId() }).select().single();
    return data;
  },

  async getItems() {
    const { data } = await supabase.from('items').select('*').eq('restaurant_id', getRestId()).order('created_at', { ascending: false });
    return (data || []).map(i => ({ ...i, par: i.par_level }));
  },
  
  async addItem(itemData) {
    const { data } = await supabase.from('items').insert({
      restaurant_id: getRestId(), name: itemData.name, unit: itemData.unit, par_level: itemData.par
    }).select().single();
    return { ...data, par: data.par_level };
  },
  
  async deleteItem(id) {
    await supabase.from('items').delete().eq('id', id);
    return true;
  },
  
  async addTransaction(txData) {
    const { data } = await supabase.from('inventory_transactions').insert({
      restaurant_id: getRestId(), branch_id: txData.branchId, item_id: txData.itemId,
      transaction_type: txData.type, qty: txData.qty, unit_cost: txData.unitCost, notes: txData.notes, reference_id: txData.referenceId
    }).select().single();
    return data;
  },

  async applyStockCount(branchId, countData) {
    const batchRef = `COUNT-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    const inserts = countData.filter(item => item.diff !== 0).map(item => ({
      restaurant_id: getRestId(), branch_id: branchId, item_id: item.itemId,
      transaction_type: 'ADJUSTMENT', qty: item.diff, unit_cost: item.unitCost, reference_id: batchRef, notes: 'تسوية جرد فعلي'
    }));
    if (inserts.length > 0) await supabase.from('inventory_transactions').insert(inserts);
    return true;
  },

  async getStockBalances(branchId = null) {
    let query = supabase.from('inventory_transactions').select('item_id, qty, unit_cost').eq('restaurant_id', getRestId());
    if (branchId) query = query.eq('branch_id', branchId);
    const { data } = await query;
    const balances = {}; 
    (data || []).forEach(tx => {
      if (!balances[tx.item_id]) balances[tx.item_id] = { qty: 0, totalValue: 0 };
      balances[tx.item_id].qty += Number(tx.qty);
      balances[tx.item_id].totalValue += (Number(tx.qty) * Number(tx.unit_cost));
    });
    return balances;
  },

  async getTransactions(branchId = null) {
    let query = supabase.from('inventory_transactions').select('*').eq('restaurant_id', getRestId()).order('created_at', { ascending: false });
    if (branchId) query = query.eq('branch_id', branchId);
    const { data } = await query;
    return (data || []).map(tx => ({
      id: tx.id, branchId: tx.branch_id, itemId: tx.item_id, type: tx.transaction_type,
      qty: Number(tx.qty), unitCost: Number(tx.unit_cost), notes: tx.notes, referenceId: tx.reference_id, createdAt: tx.created_at
    }));
  }
};

function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const keys = Object.keys(rows[0]);
  const csvContent = '\uFEFF' + [
    keys.join(','), ...rows.map(row => keys.map(k => `"${String(row[k] || '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.setAttribute('href', url); link.setAttribute('download', filename);
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ==========================================
// 🎨 واجهة المستخدم (React UI)
// ==========================================
export default function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authForm, setAuthForm] = useState({ email: '', password: '' });

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [branches, setBranches] = useState([]);
  const [items, setItems] = useState([]);
  const [balances, setBalances] = useState({});
  const [transactions, setTransactions] = useState([]);
  
  const [activeBranch, setActiveBranch] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');

  const [txForm, setTxForm] = useState({ type: 'PURCHASE', itemId: '', qty: '', unitCost: '', notes: '' });
  const [itemForm, setItemForm] = useState({ name: '', unit: 'كجم', par: '' });
  const [onboardingForm, setOnboardingForm] = useState({ businessName: '', firstBranch: 'المخزن الرئيسي' });
  const [newBranchName, setNewBranchName] = useState('');
  const [isCounting, setIsCounting] = useState(false);
  const [countInputs, setCountInputs] = useState({});
  const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'alert', onConfirm: null });

  // إدارة الجلسات (Auth)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      handleSessionData(session);
      if (!session) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      handleSessionData(session);
      if (!session) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSessionData = (sessionObj) => {
    if (sessionObj?.user?.user_metadata?.restaurant_id) {
      localStorage.setItem('costora_inv_restaurant_id', sessionObj.user.user_metadata.restaurant_id);
      localStorage.setItem('costora_inv_restaurant_name', sessionObj.user.user_metadata.restaurant_name || '');
    }
  };

  useEffect(() => { if (session) loadData(); }, [session, activeBranch]);

  const loadData = async () => {
    setLoading(true);
    try {
      const fetchedSettings = await DB.getSettings();
      if (!fetchedSettings) { setSettings(null); setLoading(false); return; }

      const fetchedBranches = await DB.getBranches();
      if (!fetchedBranches.length) { setSettings(null); setLoading(false); return; }

      let currentBranch = activeBranch;
      if (!currentBranch && fetchedBranches.length > 0) {
        currentBranch = fetchedBranches[0].id;
        setActiveBranch(currentBranch);
      }

      const [fetchedItems, fetchedBalances, fetchedTxs] = await Promise.all([
        DB.getItems(), DB.getStockBalances(currentBranch), DB.getTransactions(currentBranch)
      ]);
      
      setSettings(fetchedSettings);
      setBranches(fetchedBranches);
      setItems(fetchedItems);
      setBalances(fetchedBalances);
      setTransactions(fetchedTxs);
      
      if (!txForm.itemId && fetchedItems.length > 0) setTxForm(prev => ({ ...prev, itemId: fetchedItems[0].id }));
    } catch (err) {
      console.error(err);
      showAlert('خطأ', 'تأكد من اتصالك بالإنترنت.');
    }
    setLoading(false);
  };

  const showConfirm = (title, message, onConfirm) => setModal({ isOpen: true, title, message, type: 'confirm', onConfirm });
  const showAlert = (title, message) => setModal({ isOpen: true, title, message, type: 'alert', onConfirm: null });
  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  // دوال تسجيل الدخول
  const handleSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email: authForm.email, password: authForm.password });
    if (error) showAlert('خطأ', error.message);
    else {
      showAlert('نجاح', 'تم إنشاء الحساب بنجاح. يمكنك تسجيل الدخول الآن.');
      setAuthMode('login');
      setAuthForm({email: '', password: ''});
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
    if (error) showAlert('خطأ', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    localStorage.removeItem('costora_inv_restaurant_id');
    localStorage.removeItem('costora_inv_restaurant_name');
    setSettings(null); setBranches([]); setItems([]); setTransactions([]); setBalances({}); setActiveBranch('');
    setLoading(false);
  };

  const handleOnboarding = async (e) => {
    e.preventDefault();
    if (!onboardingForm.businessName || !onboardingForm.firstBranch) return;
    setLoading(true);
    try {
      const { data: rest, error: err1 } = await supabase.from('restaurants').insert({ name: onboardingForm.businessName }).select().single();
      if (err1) throw err1;

      const { error: err2 } = await supabase.from('branches').insert({ name: onboardingForm.firstBranch, restaurant_id: rest.id });
      if (err2) throw err2;

      await supabase.auth.updateUser({ data: { restaurant_id: rest.id, restaurant_name: rest.name } });
      localStorage.setItem('costora_inv_restaurant_id', rest.id);
      localStorage.setItem('costora_inv_restaurant_name', rest.name);
      
      await loadData();
    } catch (err) {
      showAlert('خطأ', 'حصل مشكلة أثناء التسجيل.');
      setLoading(false);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name || !itemForm.unit) return;
    try { await DB.addItem({ name: itemForm.name, unit: itemForm.unit, par: Number(itemForm.par) || 0 }); setItemForm({ name: '', unit: 'كجم', par: '' }); loadData(); } 
    catch (err) { showAlert('خطأ', 'مقدرناش نضيف الصنف.'); }
  };
  
  const handleDeleteItem = (id) => {
    showConfirm('تأكيد الحذف', 'متأكد إنك عايز تحذف الصنف ده؟ مش هينفع تسترجعه تاني.', async () => {
      try { await DB.deleteItem(id); loadData(); } catch (err) { showAlert('خطأ', 'مقدرناش نحذف الصنف.'); }
      closeModal();
    });
  };

  const handleAddBranch = async (e) => {
    e.preventDefault();
    if (!newBranchName) return;
    try { await DB.addBranch(newBranchName); setNewBranchName(''); loadData(); } catch (err) { showAlert('خطأ', 'مقدرناش نضيف الفرع.'); }
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    if (!txForm.itemId || !txForm.qty || !txForm.unitCost) return;
    let finalQty = Number(txForm.qty);
    if (txForm.type === 'WASTE' || txForm.type === 'TRANSFER_OUT') finalQty = -Math.abs(finalQty);

    try {
      await DB.addTransaction({
        type: txForm.type, itemId: txForm.itemId, qty: finalQty, unitCost: Number(txForm.unitCost), branchId: activeBranch, notes: txForm.notes
      });
      setTxForm(prev => ({ ...prev, qty: '', unitCost: '', notes: '' }));
      setActiveTab('balances');
      loadData();
    } catch (err) { showAlert('خطأ', 'مقدرناش نسجل الحركة.'); }
  };

  const handleApplyCount = () => {
    showConfirm('اعتماد تسوية الجرد', 'النظام هيحدث الرصيد تلقائياً. متأكد من الأرقام؟', async () => {
      const countData = items.map(item => {
        const b = balances[item.id] || { qty: 0, totalValue: 0 };
        const avgCost = b.qty > 0 ? (b.totalValue / b.qty) : 0;
        const actual = countInputs[item.id] !== undefined ? Number(countInputs[item.id]) : b.qty;
        return { itemId: item.id, systemQty: b.qty, actualQty: actual, diff: actual - b.qty, unitCost: avgCost };
      });
      try {
        await DB.applyStockCount(activeBranch, countData);
        setIsCounting(false); setCountInputs({}); loadData(); setActiveTab('balances');
      } catch (err) { showAlert('خطأ', 'مقدرناش نعتمد تسوية الجرد.'); }
      closeModal();
    });
  };

  const exportForCostApp = () => {
    const costAppIngredients = items.map(item => {
      const b = balances[item.id] || { qty: 0, totalValue: 0 };
      const avgCost = b.qty > 0 ? (b.totalValue / b.qty) : 0;
      return { id: item.id, name: item.name, unit: item.unit, qty: 1, price: avgCost, yield: 1, stock: b.qty, cat: '', par: item.par };
    });
    const exportData = { v: 1, ings: costAppIngredients };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `Costora_Integration_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showAlert('تم التصدير بنجاح!', 'افتح "برنامج الكوست كنترول"، ادخل الإعدادات، واعمل "استيراد JSON". الأسعار هتتحدث!');
  };

  const exportBalancesCSV = () => {
    const rows = items.map(item => {
      const b = balances[item.id] || { qty: 0, totalValue: 0 };
      return { 'الصنف': item.name, 'الرصيد الفعلي': b.qty.toFixed(2), 'الوحدة': item.unit, 'القيمة (ج.م)': b.totalValue.toFixed(2), 'حالة المخزون': b.qty <= (item.par || 0) ? 'نواقص' : 'متوفر' };
    });
    downloadCSV(`أرصدة_${currentBranchName}_${new Date().toISOString().split('T')[0]}.csv`, rows);
  };

  const exportLedgerCSV = () => {
    const typeMap = { 'PURCHASE': 'مشتريات', 'WASTE': 'هالك', 'TRANSFER_OUT': 'تحويل صادر', 'TRANSFER_IN': 'تحويل وارد', 'ADJUSTMENT': 'تسوية' };
    const rows = transactions.map(tx => {
      const item = items.find(i => i.id === tx.itemId);
      return { 'التاريخ': new Date(tx.createdAt).toLocaleString('en-GB'), 'النوع': typeMap[tx.type] || tx.type, 'الصنف': item?.name || 'محذوف', 'الكمية': tx.qty, 'الوحدة': item?.unit || '', 'السعر': tx.unitCost, 'البيان': tx.notes || '' };
    });
    downloadCSV(`حركات_${currentBranchName}_${new Date().toISOString().split('T')[0]}.csv`, rows);
  };

  const dashboardStats = useMemo(() => {
    let totalValue = 0; const lowStockItems = []; const topValuedItems = [];
    items.forEach(item => {
      const b = balances[item.id] || { qty: 0, totalValue: 0 };
      totalValue += b.totalValue;
      if (b.qty <= (item.par || 0)) lowStockItems.push({ ...item, currentQty: b.qty });
      if (b.totalValue > 0) topValuedItems.push({ ...item, totalValue: b.totalValue, qty: b.qty });
    });
    topValuedItems.sort((a, b) => b.totalValue - a.totalValue);
    return { totalValue, lowStockItems, topValuedItems: topValuedItems.slice(0, 5) };
  }, [items, balances]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans" dir="rtl"><div className="animate-pulse text-indigo-600 font-bold flex items-center gap-2"><RefreshCw className="animate-spin"/> جاري التحميل...</div></div>;

  // شاشة تسجيل الدخول / إنشاء حساب
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-900 p-4 font-sans" dir="rtl">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-100">
          <div className="flex justify-center mb-6"><div className="bg-indigo-50 p-5 rounded-full text-indigo-600 shadow-inner"><Store size={48} /></div></div>
          <h1 className="text-2xl font-black text-center text-gray-800 mb-2">Costora Inventory</h1>
          <p className="text-gray-500 text-center text-sm mb-8 font-medium">نظام المخازن السحابي الموحد</p>
          <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp} className="space-y-5">
            <div><label className="block text-sm font-bold text-gray-700 mb-2">البريد الإلكتروني</label><input type="email" required value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3.5 focus:border-indigo-500 outline-none font-semibold" placeholder="name@restaurant.com" /></div>
            <div><label className="block text-sm font-bold text-gray-700 mb-2">كلمة المرور</label><input type="password" required minLength="6" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3.5 focus:border-indigo-500 outline-none font-semibold" placeholder="******" /></div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg mt-4 text-lg">
              {authMode === 'login' ? 'تسجيل الدخول 🚀' : 'إنشاء حساب جديد ✨'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
              {authMode === 'login' ? 'معندكش حساب؟ أنشئ حساب جديد' : 'عندك حساب بالفعل؟ سجل دخول'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // شاشة إعداد المطعم لأول مرة
  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-900 p-4 font-sans" dir="rtl">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-100">
          <div className="flex justify-center mb-6"><div className="bg-indigo-50 p-5 rounded-full text-indigo-600 shadow-inner"><Store size={48} /></div></div>
          <h1 className="text-2xl font-black text-center text-gray-800 mb-2">إعداد مساحة العمل</h1>
          <p className="text-gray-500 text-center text-sm mb-8 font-medium">سجل بيانات نشاطك لربطها بحسابك</p>
          <form onSubmit={handleOnboarding} className="space-y-5">
            <div><label className="block text-sm font-bold text-gray-700 mb-2">اسم النشاط</label><input type="text" required value={onboardingForm.businessName} onChange={e => setOnboardingForm({...onboardingForm, businessName: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3.5 focus:border-indigo-500 outline-none font-semibold" placeholder="مثال: GreekClub" /></div>
            <div><label className="block text-sm font-bold text-gray-700 mb-2">اسم الفرع الأول</label><input type="text" required value={onboardingForm.firstBranch} onChange={e => setOnboardingForm({...onboardingForm, firstBranch: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3.5 focus:border-indigo-500 outline-none font-semibold" placeholder="مثال: فرع القاهرة" /></div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg mt-4 text-lg">البدء في استخدام النظام 🚀</button>
          </form>
        </div>
      </div>
    );
  }

  const currentBranchName = branches.find(b => b.id === activeBranch)?.name || '';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800 pb-20 md:pb-0" dir="rtl">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-2.5 rounded-xl shadow-sm"><Store size={22} /></div>
              <div><h1 className="font-black text-lg text-gray-900 leading-tight">{settings.businessName}</h1><p className="text-[11px] text-emerald-600 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> متصل بـ Supabase</p></div>
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <select value={activeBranch} onChange={e => setActiveBranch(e.target.value)} className="appearance-none bg-slate-100 border border-slate-200 text-slate-800 text-sm font-bold rounded-lg pl-8 pr-4 py-2 outline-none"><option value="">كل الفروع</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <button onClick={handleLogout} className="text-rose-500 p-2 bg-rose-50 rounded-lg border border-rose-200"><LogOut size={16}/></button>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-100/80 p-1.5 rounded-xl border border-slate-200">
              <button onClick={() => setActiveBranch('')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeBranch === '' ? 'bg-white text-indigo-700 shadow-md ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-800'}`}>الكل</button>
              {branches.map(branch => (
                <button key={branch.id} onClick={() => setActiveBranch(branch.id)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeBranch === branch.id ? 'bg-white text-indigo-700 shadow-md ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-800'}`}>{branch.name}</button>
              ))}
            </div>
            <button onClick={handleLogout} className="flex items-center gap-2 text-sm font-bold text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 bg-rose-50 px-3 py-2 rounded-lg transition-all shadow-sm">
               <LogOut size={16}/> خروج
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto hide-scrollbar pb-1">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'لوحة المراقبة' },
            { id: 'balances', icon: Package, label: 'الأرصدة الحالية' },
            { id: 'count', icon: ClipboardCheck, label: 'تسوية الجرد', branchOnly: true },
            { id: 'addTx', icon: ArrowRightLeft, label: 'تسجيل حركة', branchOnly: true },
            { id: 'history', icon: History, label: 'سجل الحركات' },
            { id: 'items', icon: ListPlus, label: 'تكويد الأصناف' },
            { id: 'settings', icon: Settings, label: 'الإعدادات والربط' },
          ].map(tab => {
            if (tab.branchOnly && !activeBranch) return null;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`pb-2.5 px-4 flex items-center gap-2 font-bold text-sm border-b-4 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50 rounded-t-lg' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-t-lg'}`}>
                <tab.icon size={18} /> {tab.label}
              </button>
            )
          })}
        </div>

        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition"><div className="bg-indigo-50 text-indigo-600 p-3.5 rounded-xl"><TrendingUp size={24}/></div><div><p className="text-gray-500 text-xs font-bold mb-1">إجمالي قيمة المخزون</p><h3 className="text-2xl font-black text-gray-900">{dashboardStats.totalValue.toLocaleString('en-US')} <span className="text-sm text-gray-500 font-semibold">ج.م</span></h3></div></div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition"><div className="bg-emerald-50 text-emerald-600 p-3.5 rounded-xl"><Package size={24}/></div><div><p className="text-gray-500 text-xs font-bold mb-1">الخامات المكودة</p><h3 className="text-2xl font-black text-gray-900">{items.length} <span className="text-sm text-gray-500 font-semibold">صنف</span></h3></div></div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition"><div className="bg-rose-50 text-rose-600 p-3.5 rounded-xl"><AlertTriangle size={24}/></div><div><p className="text-gray-500 text-xs font-bold mb-1">نواقص (تحت حد الطلب)</p><h3 className="text-2xl font-black text-rose-600">{dashboardStats.lowStockItems.length} <span className="text-sm text-gray-500 font-semibold">صنف</span></h3></div></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 bg-rose-50/50 border-b border-gray-100 flex justify-between items-center"><h3 className="font-bold text-rose-800 flex items-center gap-2"><AlertTriangle size={18}/> تنبيهات النواقص</h3><span className="text-xs font-bold bg-rose-100 text-rose-600 px-2 py-1 rounded-md">{dashboardStats.lowStockItems.length}</span></div>
                {dashboardStats.lowStockItems.length === 0 ? <div className="p-8 text-center text-sm text-gray-400 font-semibold">المخزون آمن! 🎉</div> : (
                  <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {dashboardStats.lowStockItems.map(item => (
                      <div key={item.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                        <div><p className="font-bold text-gray-800">{item.name}</p><p className="text-xs text-gray-500 font-semibold mt-0.5">حد الطلب: {item.par} {item.unit}</p></div>
                        <div className="text-left"><p className="font-black text-rose-600">{item.currentQty.toFixed(2)} <span className="text-xs">{item.unit}</span></p><p className="text-[10px] text-rose-400 font-bold">عجز {Math.abs(item.currentQty - item.par).toFixed(2)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 bg-indigo-50/50 border-b border-gray-100"><h3 className="font-bold text-indigo-800 flex items-center gap-2"><TrendingUp size={18}/> أعلى 5 أصناف قيمة</h3></div>
                <div className="divide-y divide-gray-100">
                  {dashboardStats.topValuedItems.map((item, idx) => (
                    <div key={item.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
                      <div className="flex items-center gap-3"><span className="bg-slate-100 text-slate-500 font-black w-6 h-6 rounded-full flex items-center justify-center text-xs">{idx + 1}</span><div><p className="font-bold text-gray-800">{item.name}</p><p className="text-xs text-gray-500 font-semibold mt-0.5">رصيد: {item.qty.toFixed(2)} {item.unit}</p></div></div>
                      <p className="font-black text-gray-900">{item.totalValue.toLocaleString('en-US')} <span className="text-xs text-gray-500">ج.م</span></p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'balances' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-5 border-b border-gray-100 bg-slate-50/80 flex flex-wrap gap-4 justify-between items-center">
              <div><h2 className="font-bold text-lg text-gray-800">أرصدة {activeBranch ? currentBranchName : 'جميع الفروع مجمعة'}</h2></div>
              <div className="flex items-center gap-3"><button onClick={exportBalancesCSV} className="text-xs font-bold bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-50 shadow-sm flex items-center gap-2"><Download size={14}/> تصدير CSV</button><span className="text-sm bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-xl font-bold shadow-sm">القيمة: {items.reduce((sum, item) => sum + (balances[item.id]?.totalValue || 0), 0).toLocaleString('en-US')} ج.م</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-gray-200">
                  <tr><th className="p-4">الصنف</th><th className="p-4">الرصيد الفعلي</th><th className="p-4">متوسط التكلفة</th><th className="p-4">القيمة الإجمالية</th><th className="p-4">حالة المخزون</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(item => {
                    const b = balances[item.id] || { qty: 0, totalValue: 0 };
                    const avgCost = b.qty > 0 ? (b.totalValue / b.qty) : 0;
                    return (
                      <tr key={item.id} className="hover:bg-indigo-50/30 transition-colors">
                        <td className="p-4 font-bold text-gray-800">{item.name}</td>
                        <td className="p-4 font-black text-indigo-700" dir="ltr">{b.qty.toFixed(2)} <span className="text-gray-400 text-xs font-semibold">{item.unit}</span></td>
                        <td className="p-4 text-gray-600 font-semibold">{avgCost.toFixed(2)} ج.م</td>
                        <td className="p-4 font-black text-gray-900">{b.totalValue.toLocaleString('en-US')} ج.م</td>
                        <td className="p-4">{b.qty <= (item.par || 0) ? <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-rose-50 text-rose-600 px-2.5 py-1 rounded-lg">نواقص</span> : <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg">متوفر</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'count' && activeBranch && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-5 border-b border-gray-100 bg-slate-50/80 flex flex-wrap gap-4 justify-between items-center">
              <div><h2 className="font-bold text-lg text-gray-800 flex items-center gap-2"><ClipboardCheck size={20} className="text-indigo-600"/> جرد {currentBranchName}</h2></div>
              {!isCounting && items.length > 0 && <button onClick={() => setIsCounting(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md">ابدأ جرد جديد</button>}
            </div>
            {!isCounting ? <div className="p-16 text-center"><ClipboardCheck size={48} className="mx-auto text-slate-300 mb-4" /><p className="text-gray-500 font-bold">اضغط على "ابدأ جرد جديد" لفتح ورقة العمل.</p></div> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm whitespace-nowrap">
                    <thead className="bg-slate-800 text-white font-bold">
                      <tr><th className="p-4 rounded-tr-lg">الصنف</th><th className="p-4">الدفترى</th><th className="p-4 bg-indigo-700">الفعلي (الجرد)</th><th className="p-4">الفرق</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map(item => {
                        const sysQty = balances[item.id]?.qty || 0;
                        const actualStr = countInputs[item.id];
                        const actualQty = actualStr !== undefined && actualStr !== '' ? Number(actualStr) : sysQty;
                        const diff = actualQty - sysQty;
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="p-4 font-bold text-gray-800">{item.name}</td>
                            <td className="p-4 font-semibold text-gray-500" dir="ltr">{sysQty.toFixed(2)} {item.unit}</td>
                            <td className="p-4 bg-indigo-50/30"><div className="flex items-center gap-2" dir="ltr"><span className="text-xs text-gray-400 font-bold">{item.unit}</span><input type="number" step="any" value={actualStr !== undefined ? actualStr : ''} onChange={e => setCountInputs({...countInputs, [item.id]: e.target.value})} className="w-24 border border-indigo-300 rounded-lg p-2 text-center font-black focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-900" placeholder={sysQty.toFixed(2)}/></div></td>
                            <td className="p-4 font-black" dir="ltr">{diff === 0 ? <span className="text-gray-300">-</span> : diff > 0 ? <span className="text-emerald-600">+{diff.toFixed(2)}</span> : <span className="text-rose-600">{diff.toFixed(2)}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="p-5 bg-slate-50 border-t border-gray-200 flex justify-end gap-3"><button onClick={() => {setIsCounting(false); setCountInputs({});}} className="px-5 py-2.5 rounded-xl font-bold text-sm text-gray-600 hover:bg-gray-200">إلغاء</button><button onClick={handleApplyCount} className="bg-indigo-600 text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow-md">اعتماد الجرد</button></div>
              </>
            )}
          </div>
        )}

        {activeTab === 'addTx' && activeBranch && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-2xl mx-auto animate-in fade-in duration-300">
            <h2 className="font-black text-xl mb-6 flex items-center gap-3 text-gray-800"><div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-xl"><ArrowRightLeft size={22} /></div> حركة في {currentBranchName}</h2>
            <form onSubmit={handleAddTransaction} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div><label className="block text-sm font-bold text-gray-700 mb-2">نوع الحركة</label><select value={txForm.type} onChange={(e) => setTxForm({...txForm, type: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 outline-none font-bold text-gray-800"><option value="PURCHASE">📥 مشتريات</option><option value="WASTE">🗑️ هالك</option><option value="TRANSFER_OUT">🚚 تحويل صادر</option><option value="TRANSFER_IN">🚚 تحويل وارد</option><option value="ADJUSTMENT">⚖️ تسوية</option></select></div>
                <div><label className="block text-sm font-bold text-gray-700 mb-2">الصنف</label><select value={txForm.itemId} onChange={(e) => setTxForm({...txForm, itemId: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 outline-none font-bold text-gray-800">{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div><label className="block text-sm font-bold text-gray-700 mb-2">الكمية</label><input type="number" step="any" min="0.01" required value={txForm.qty} onChange={(e) => setTxForm({...txForm, qty: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 outline-none font-bold"/></div>
                <div><label className="block text-sm font-bold text-gray-700 mb-2">التكلفة للوحدة (ج.م)</label><input type="number" step="any" min="0" required value={txForm.unitCost} onChange={(e) => setTxForm({...txForm, unitCost: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 outline-none font-bold"/></div>
              </div>
              <div><label className="block text-sm font-bold text-gray-700 mb-2">ملاحظات</label><input type="text" value={txForm.notes} onChange={(e) => setTxForm({...txForm, notes: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 focus:border-indigo-500 outline-none font-bold" placeholder="مثال: فاتورة المورد 123..."/></div>
              <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl shadow-lg mt-2 text-lg">تسجيل</button>
            </form>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
            <div className="p-5 border-b border-gray-100 bg-slate-50/80 flex justify-between items-center"><h2 className="font-bold text-lg text-gray-800">سجل الحركات</h2><button onClick={exportLedgerCSV} disabled={!transactions.length} className="text-xs font-bold bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2 shadow-sm"><Download size={14}/> تصدير CSV</button></div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-gray-200">
                  <tr><th className="p-4">التاريخ</th><th className="p-4">النوع</th><th className="p-4">الصنف</th><th className="p-4">الكمية</th><th className="p-4">السعر</th><th className="p-4">البيان</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map(tx => {
                    const item = items.find(i => i.id === tx.itemId);
                    return (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="p-4 text-gray-500 text-xs font-bold" dir="ltr">{new Date(tx.createdAt).toLocaleString('en-GB')}</td>
                        <td className="p-4"><span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">{tx.type}</span></td>
                        <td className="p-4 font-bold text-gray-800">{item?.name || 'محذوف'}</td>
                        <td className={`p-4 font-black ${tx.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`} dir="ltr">{tx.qty > 0 ? '+' : ''}{tx.qty}</td>
                        <td className="p-4 text-gray-600 font-bold">{tx.unitCost} ج.م</td>
                        <td className="p-4 text-gray-500 text-xs">{tx.notes || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'items' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
            <div className="lg:col-span-1">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sticky top-24">
                <h2 className="font-bold text-lg mb-4 text-gray-800 border-b pb-3">إضافة خامة</h2>
                <form onSubmit={handleAddItem} className="space-y-4">
                  <div><label className="block text-xs font-bold text-gray-700 mb-1">الاسم</label><input type="text" required value={itemForm.name} onChange={e => setItemForm({...itemForm, name: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none font-bold" /></div>
                  <div><label className="block text-xs font-bold text-gray-700 mb-1">الوحدة</label><select value={itemForm.unit} onChange={e => setItemForm({...itemForm, unit: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none font-bold"><option>كجم</option><option>لتر</option><option>قطعة</option><option>جم</option></select></div>
                  <div><label className="block text-xs font-bold text-gray-700 mb-1">حد الطلب (Par)</label><input type="number" min="0" value={itemForm.par} onChange={e => setItemForm({...itemForm, par: e.target.value})} className="w-full border-2 border-gray-200 rounded-xl p-3 text-sm focus:border-indigo-500 outline-none font-bold" /></div>
                  <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl shadow-md text-sm">حفظ</button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-slate-50/80"><h2 className="font-bold text-gray-800">الأصناف ({items.length})</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-gray-200">
                      <tr><th className="p-3">الصنف</th><th className="p-3">الوحدة</th><th className="p-3">الحد</th><th className="p-3 text-center">حذف</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map(item => (
                        <tr key={item.id} className="hover:bg-gray-50"><td className="p-3 font-bold">{item.name}</td><td className="p-3 text-gray-500">{item.unit}</td><td className="p-3 font-black text-indigo-600">{item.par || 0}</td><td className="p-3 text-center"><button onClick={() => handleDeleteItem(item.id)} className="text-rose-400 hover:text-rose-600"><Trash2 size={16} /></button></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto space-y-6 animate-in fade-in duration-300">
            <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 rounded-2xl shadow-lg border border-indigo-800 p-6 text-white relative overflow-hidden">
              <div className="absolute -right-10 -top-10 opacity-10"><Settings size={150} /></div>
              <h2 className="font-black text-xl mb-2 flex items-center gap-2 relative z-10"><RefreshCw size={22}/> الربط ببرنامج الكوست كنترول</h2>
              <p className="text-indigo-100 mb-6 font-medium text-sm relative z-10 leading-relaxed">
                تقدر تصدّر كل الخامات اللي متكودة هنا بأرصدتها ومتوسط تكلفتها الحالية. خد الملف ده ارفعه في برنامج "الكوست كنترول" عشان الأسعار تتحدث أوتوماتيك للريسبيز والأطباق!
              </p>
              <button onClick={exportForCostApp} className="w-full bg-white text-indigo-800 hover:bg-indigo-50 font-bold px-6 py-4 rounded-xl shadow-md text-sm transition-all flex items-center justify-center gap-2 relative z-10">
                <Download size={18}/> تحميل داتا المخازن للكوست (JSON)
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="font-bold text-lg mb-4 text-gray-800 border-b pb-3 flex items-center gap-2"><Building2 size={20} className="text-indigo-600"/> الفروع</h2>
              <div className="space-y-3 mb-6">
                {branches.map(b => (
                  <div key={b.id} className="flex justify-between bg-slate-50 border p-3 rounded-xl"><span className="font-bold">{b.name}</span><span className="text-xs text-gray-400">سحابي</span></div>
                ))}
              </div>
              <form onSubmit={handleAddBranch} className="flex gap-3">
                <input type="text" required value={newBranchName} onChange={e => setNewBranchName(e.target.value)} className="flex-1 border-2 rounded-xl p-3 text-sm font-bold" placeholder="فرع جديد..."/>
                <button type="submit" className="bg-indigo-600 text-white font-bold px-6 rounded-xl">إضافة</button>
              </form>
            </div>
          </div>
        )}

      </main>
      
      <div className="h-6 md:hidden"></div>

      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`p-4 border-b ${modal.type === 'alert' ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'} flex justify-between items-center`}>
              <h3 className={`font-bold text-lg ${modal.type === 'alert' ? 'text-rose-800' : 'text-slate-800'}`}>{modal.title}</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <div className="p-6"><p className="text-slate-600 font-medium leading-relaxed">{modal.message}</p></div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              {modal.type === 'confirm' && <button onClick={closeModal} className="px-4 py-2 rounded-xl font-bold text-slate-600">إلغاء</button>}
              <button onClick={() => { if (modal.onConfirm) modal.onConfirm(); else closeModal(); }} className={`px-6 py-2 rounded-xl font-bold text-white shadow-sm ${modal.type === 'alert' ? 'bg-rose-600' : 'bg-indigo-600'}`}>موافق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
