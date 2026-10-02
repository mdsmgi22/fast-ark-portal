"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function StaffManagementEngine() {
  const router = useRouter(); // Added router injection
  const [staffList, setStaffList] = useState<any[]>([]);
  const [isSubmittingStaff, setIsSubmittingStaff] = useState(false);
  
  // [FIX]: Added routing state for smooth transition
  const [isRouting, setIsRouting] = useState(false);
  const LIMITS = { Manager: 3, Accountant: 3, Staff: 11 };
  
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    mobile: "",
    role: "Staff"
  });

  useEffect(() => {
    fetchStaffList();
  }, []);

  const fetchStaffList = async () => {
    const { data, error } = await supabase
      .from("back_office_staff")
      .select("*")
      .order("role", { ascending: true });
    
    if (error) console.error("Error loading staff:", error);
    setStaffList(data || []);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingStaff(true);

    try {
      const { error } = await supabase.from("back_office_staff").insert([staffForm]);
      if (error) throw error;

      alert(`✅ New ${staffForm.role} account created for ${staffForm.name}. They can now be assigned credentials.`);
      setStaffForm({ name: "", email: "", mobile: "", role: "Staff" });
      fetchStaffList();
    } catch (err: any) {
      alert("Error creating staff: " + err.message);
    } finally {
      setIsSubmittingStaff(false);
    }
  };

  const toggleStaffStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    if (!confirm(`Are you sure you want to mark this staff member as ${newStatus}?`)) return;
    
    try {
      const { error } = await supabase.from("back_office_staff").update({ status: newStatus }).eq("id", id);
      if (error) throw error;
      fetchStaffList();
    } catch (err: any) {
      alert("Error updating status: " + err.message);
    }
  };

  // Secure Router Push
  const routeToMatrix = () => {
    setIsRouting(true);
    router.push("/dashboard/staff-reports");
    setTimeout(() => setIsRouting(false), 8000); // 8-second safety release
  };

  const getRoleCount = (roleName: string) => staffList.filter(s => s.role === roleName).length;

  return (
    <div className="border-t-4 border-slate-300 pt-8 mt-8 animate-in fade-in slide-in-from-bottom-4">
      <h2 className="text-2xl font-black text-slate-900 mb-2 flex items-center gap-2">
        <span>👥</span> Staff Management Engine
      </h2>
      <p className="text-sm text-slate-500 font-bold mb-6">God Mode access. Provision roles, monitor usage limits, and control internal access.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Create New Staff Form */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-fit">
          <h3 className="text-lg font-black text-slate-800 mb-4 pb-2 border-b">Onboard New Team Member</h3>
          
          <div className="grid grid-cols-3 gap-2 mb-6">
            <div className="bg-slate-100 p-2 rounded text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Managers</p>
              <p className={`font-black ${getRoleCount('Manager') >= LIMITS.Manager ? 'text-red-600' : 'text-slate-800'}`}>
                {getRoleCount('Manager')}/{LIMITS.Manager}
              </p>
            </div>
            <div className="bg-slate-100 p-2 rounded text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Accountants</p>
              <p className={`font-black ${getRoleCount('Accountant') >= LIMITS.Accountant ? 'text-red-600' : 'text-slate-800'}`}>
                {getRoleCount('Accountant')}/{LIMITS.Accountant}
              </p>
            </div>
            <div className="bg-slate-100 p-2 rounded text-center">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Staff</p>
              <p className={`font-black ${getRoleCount('Staff') >= LIMITS.Staff ? 'text-red-600' : 'text-slate-800'}`}>
                {getRoleCount('Staff')}/{LIMITS.Staff}
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateStaff} className="space-y-4 text-sm">
            <div>
              <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Full Name</label>
              <input required type="text" value={staffForm.name} onChange={e => setStaffForm({...staffForm, name: e.target.value})} className="w-full border p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Official Email</label>
              <input required type="email" value={staffForm.email} onChange={e => setStaffForm({...staffForm, email: e.target.value})} className="w-full border p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Mobile Number</label>
              <input required type="text" maxLength={10} value={staffForm.mobile} onChange={e => setStaffForm({...staffForm, mobile: e.target.value.replace(/\D/g, '')})} className="w-full border p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-slate-700 font-bold mb-1 uppercase text-[10px] tracking-widest">Assigned Role</label>
              <select value={staffForm.role} onChange={e => setStaffForm({...staffForm, role: e.target.value})} className="w-full border p-2.5 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 font-bold">
                <option value="Staff">General Staff</option>
                <option value="Manager">Manager</option>
                <option value="Accountant">Accountant</option>
              </select>
            </div>
            
            <button type="submit" disabled={isSubmittingStaff} className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-lg transition shadow-md disabled:bg-slate-400 mt-2">
              {isSubmittingStaff ? "Processing..." : "Create Internal Account"}
            </button>
          </form>

          {/* UPGRADED ROUTER BUTTON */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <button 
              onClick={routeToMatrix}
              disabled={isRouting}
              className="block w-full py-3 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-black rounded-lg transition text-center text-xs uppercase tracking-widest disabled:opacity-50"
            >
              {isRouting ? "Loading Matrix..." : "👁️ View Staff Productivity Matrix"}
            </button>
          </div>
        </div>

        {/* Right Side: Active Staff Directory */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-fit">
          <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
            <h3 className="font-black text-slate-800">Internal Directory</h3>
            <span className="text-[10px] font-black uppercase tracking-widest bg-slate-200 text-slate-600 px-2 py-1 rounded">
              {staffList.length} Active Records
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest border-b border-slate-200">
                  <th className="p-4 font-black">Name & Contact</th>
                  <th className="p-4 font-black">Role</th>
                  <th className="p-4 font-black text-center">Status</th>
                  <th className="p-4 font-black text-right">Kill Switch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffList.map((s) => (
                  <tr key={s.id} className={`hover:bg-slate-50 transition ${s.status === 'Inactive' ? 'opacity-60 grayscale' : ''}`}>
                    <td className="p-4">
                      <p className="font-black text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500 font-bold mt-0.5">{s.email}</p>
                      <p className="text-xs text-slate-500 font-bold">{s.mobile}</p>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-widest border shadow-sm ${
                        s.role === 'Admin' ? 'bg-purple-100 text-purple-800 border-purple-200' :
                        s.role === 'Manager' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                        s.role === 'Accountant' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                        'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {s.status === 'Active' ? (
                        <span className="text-[10px] font-black uppercase text-green-600 tracking-widest">✅ Active</span>
                      ) : (
                        <span className="text-[10px] font-black uppercase text-red-600 tracking-widest">❌ Inactive</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {s.role !== 'Admin' && (
                        <button 
                          onClick={() => toggleStaffStatus(s.id, s.status)}
                          className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded border shadow-sm transition ${
                            s.status === 'Active' 
                              ? 'border-red-200 text-red-600 hover:bg-red-50' 
                              : 'border-green-200 text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {s.status === 'Active' ? 'Deactivate' : 'Restore'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
      </div>
    </div>
  );
}