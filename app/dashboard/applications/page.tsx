// FILE PATH: ./app/dashboard/applications/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function ApplicationsList() {
  const router = useRouter();

  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  useEffect(() => {
    const initializePage = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }
      fetchApplications();
    };

    initializePage();

    const handleFocus = () => fetchApplications();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("popstate", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("popstate", handleFocus);
    };
  }, [router]);

  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    router.push("/login");
  };

  const fetchApplications = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pending_applications")
        .select(
          "id, name, email, mobile, requested_role, role_metadata, status, center_name, created_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) setApplications(data);

      router.refresh();
    } catch (error: any) {
      console.error("Error fetching applications:", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleViewKYC = async (app: any) => {
    const loadingKey = app.id || app.name;
    setPdfLoading(loadingKey);
    try {
      let targetFileName: string | null =
        app.role_metadata?.kyc_pdf_path || null;

      if (!targetFileName) {
        const safeName = String(app.name || "").replace(/[^a-zA-Z0-9]/g, "_");
        const expectedPrefix = `${safeName}_`;

        const { data: files, error: searchError } = await supabase.storage
          .from("application_documents")
          .list("", { search: safeName });

        if (searchError) throw searchError;

        // Strict prefix check prevents "RAJ_" from matching "RAJESH_" and sorts newest first
        const matchingPdfs = (files || [])
          .filter(
            (f) =>
              f.name.startsWith(expectedPrefix) &&
              f.name.toLowerCase().endsWith(".pdf")
          )
          .sort((a, b) => b.name.localeCompare(a.name));

        if (matchingPdfs.length > 0) {
          targetFileName = matchingPdfs[0].name;
        }
      }

      if (!targetFileName) {
        alert(
          "No KYC PDF found for this applicant. It may have been securely wiped upon rejection."
        );
        setPdfLoading(null);
        return;
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from("application_documents")
        .createSignedUrl(targetFileName, 60 * 60);

      if (urlError || !urlData?.signedUrl) throw urlError;

      window.open(urlData.signedUrl, "_blank");
    } catch (error: any) {
      console.error(error);
      alert("Error opening KYC document: " + (error?.message || "Unknown error"));
    } finally {
      setPdfLoading(null);
    }
  };

  const filteredApps = applications.filter((app) => {
    const q = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !q ||
      app.name?.toLowerCase().includes(q) ||
      app.mobile?.includes(q) ||
      app.email?.toLowerCase().includes(q) ||
      app.center_name?.toLowerCase().includes(q);

    let matchesStatus = true;
    if (statusFilter !== "All") {
      if (statusFilter === "Pending") {
        matchesStatus = app.status === "Pending" || !app.status;
      } else {
        matchesStatus = app.status === statusFilter;
      }
    }

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Approved":
        return (
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold border border-green-200">
            APPROVED
          </span>
        );
      case "Rejected":
        return (
          <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-bold border border-red-200">
            REJECTED
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold border border-yellow-200">
            PENDING
          </span>
        );
    }
  };

  const pendingCount = applications.filter(
    (a) => a.status === "Pending" || !a.status
  ).length;
  const approvedCount = applications.filter(
    (a) => a.status === "Approved"
  ).length;
  const rejectedCount = applications.filter(
    (a) => a.status === "Rejected"
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-blue-600 font-bold text-sm mb-2 hover:underline inline-flex items-center gap-1"
            >
              &larr; Back to Command Center
            </Link>
            <h1 className="text-3xl font-black text-slate-900">
              Partner Applications
            </h1>
            <p className="text-slate-500 mt-1 font-medium">
              Manage and review all incoming franchise and agent requests.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/locations">
              <button className="bg-indigo-600 border border-indigo-700 text-white px-4 py-2 rounded-md font-bold hover:bg-indigo-700 shadow-sm transition">
                📍 Manage Centers
              </button>
            </Link>
            <button
              onClick={fetchApplications}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md font-bold hover:bg-gray-50 shadow-sm transition"
            >
              ↻ Refresh List
            </button>
            <button
              onClick={handleSignOut}
              className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-md font-bold hover:bg-red-100 shadow-sm transition"
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Search by Applicant Name, Mobile, Email or Center..."
              className="w-full sm:flex-1 border border-gray-300 p-2.5 rounded outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-inner"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-56 border border-gray-300 p-2.5 rounded outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold shadow-inner bg-white text-slate-700"
            >
              <option value="Pending">
                ⏳ Approval Pending ({pendingCount})
              </option>
              <option value="Approved">✅ Approved ({approvedCount})</option>
              <option value="Rejected">❌ Rejected ({rejectedCount})</option>
              <option value="All">
                All Applications ({applications.length})
              </option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-gray-200 text-xs uppercase tracking-wider text-slate-600">
                  <th className="p-4 font-bold">Applicant Name</th>
                  <th className="p-4 font-bold">Mobile</th>
                  <th className="p-4 font-bold">Requested Role</th>
                  <th className="p-4 font-bold">Preferred Center</th>
                  <th className="p-4 font-bold">Status</th>
                  <th className="p-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-12 text-center text-blue-600 font-bold animate-pulse text-lg"
                    >
                      Authenticating and loading secure data...
                    </td>
                  </tr>
                ) : filteredApps.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-12 text-center text-gray-500 font-bold text-lg bg-slate-50"
                    >
                      No applications found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredApps.map((app) => {
                    const isRowPdfLoading =
                      pdfLoading === (app.id || app.name);
                    return (
                      <tr
                        key={app.id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="p-4 font-bold text-slate-800">
                          {app.name}
                          <div className="text-xs text-gray-400 font-normal mt-1">
                            {new Date(app.created_at).toLocaleDateString(
                              "en-IN",
                              {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              }
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-slate-600 font-medium">
                          {app.mobile}
                        </td>
                        <td className="p-4 text-blue-700 font-black text-xs uppercase">
                          {app.requested_role}
                        </td>
                        <td className="p-4 text-slate-600 font-medium">
                          {app.center_name}
                        </td>
                        <td className="p-4">{getStatusBadge(app.status)}</td>
                        <td className="p-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleViewKYC(app)}
                              disabled={isRowPdfLoading}
                              className="bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
                              title="Quick view KYC document"
                            >
                              {isRowPdfLoading ? "..." : "📄 KYC"}
                            </button>

                            <Link href={`/dashboard/applications/${app.id}`}>
                              <button className="bg-blue-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm">
                                Review
                              </button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}