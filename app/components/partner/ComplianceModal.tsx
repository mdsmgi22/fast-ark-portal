    "use client";
import React from "react";

export default function ComplianceModal({
  isOpen,
  onClose,
  hasUploadedDocs,
  requiredDocs,
  docFiles,
  handleDocFileChange,
  handleDocUploadSubmit,
  isUploadingDocs,
  docUploadMessage
}: any) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex justify-center items-end md:items-center p-0 md:p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-10 md:zoom-in-95">
        
        {/* Modal Header */}
        <div className="bg-slate-900 p-5 flex justify-between items-center shrink-0">
          <div className="text-white">
            <h2 className="font-black text-lg tracking-wide flex items-center gap-2"><span>📂</span> Mandatory Compliance</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Upload required operational documents</p>
          </div>
          <button onClick={() => !isUploadingDocs && onClose()} className="text-slate-400 hover:text-white text-3xl font-black transition">&times;</button>
        </div>
        
        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
           {hasUploadedDocs ? (
              <div className="text-center p-8 bg-emerald-50 border border-emerald-200 rounded-2xl mt-4 shadow-sm">
                 <span className="text-5xl mb-4 block">🔒</span>
                 <h3 className="font-black text-emerald-800 text-lg uppercase tracking-widest">Documents Submitted</h3>
                 <p className="text-sm font-bold text-emerald-700 mt-2">Your compliance documents have been securely merged, watermarked, and locked.</p>
              </div>
           ) : (
              <form id="compliance-form" onSubmit={handleDocUploadSubmit} className="space-y-4">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {requiredDocs.map((docName: string, idx: number) => {
                       const isMulti = docName.includes("(5 Nos)");
                       const fileData = docFiles[docName];
                       const fileCount = Array.isArray(fileData) ? fileData.length : (fileData ? 1 : 0);

                       return (
                         <div key={idx} className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm hover:border-blue-300 transition">
                            <label className="block text-xs font-black text-slate-700 uppercase tracking-widest mb-3 leading-tight border-b border-slate-100 pb-2">
                              {idx + 1}. {docName} *
                              {isMulti && <span className="block text-[10px] text-blue-600 mt-1.5 normal-case font-bold">Please select exactly 5 images at once.</span>}
                            </label>
                            <input 
                               type="file" 
                               accept=".pdf, .jpg, .jpeg, .png" 
                               required={!docFiles[docName]}
                               multiple={isMulti}
                               onChange={(e) => handleDocFileChange(e, docName, isMulti)}
                               className="w-full text-xs font-medium text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-[10px] file:uppercase file:tracking-widest file:font-black file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                            />
                            {isMulti && fileCount > 0 && (
                              <p className={`text-[10px] font-black uppercase tracking-widest mt-3 px-2 py-1.5 rounded inline-block border ${fileCount === 5 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                                {fileCount} / 5 files selected
                              </p>
                            )}
                         </div>
                       );
                    })}
                 </div>
                 
                 {docUploadMessage && (
                    <div className="p-4 bg-blue-50 text-blue-800 text-xs font-black uppercase tracking-widest rounded-xl border border-blue-200 text-center animate-pulse shadow-sm">
                       {docUploadMessage}
                    </div>
                 )}
              </form>
           )}
        </div>
        
        {/* Modal Footer */}
        {!hasUploadedDocs && (
          <div className="p-5 bg-white border-t border-slate-200 shrink-0">
             <button 
                form="compliance-form"
                type="submit" 
                disabled={isUploadingDocs}
                className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-lg uppercase tracking-widest hover:bg-blue-600 transition disabled:opacity-50 flex justify-center items-center gap-2"
             >
                {isUploadingDocs ? "Processing & Watermarking..." : "Submit & Lock Documents"}
             </button>
          </div>
        )}
      </div>
    </div>
  );
}