"use client";
import React from "react";

export default function CorporateInbox({
  messages,
  unreadCount,
  expandedMsgId,
  handleReadMessage
}: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit flex flex-col max-h-[600px]">
      <div className="p-5 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-white shrink-0">
        <div>
          <h3 className="font-black tracking-widest uppercase text-sm flex items-center gap-2"><span>💬</span> Corporate Inbox</h3>
          <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest">Official Notices & Audit Alerts</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black">{messages.length}</p>
          <p className="text-[9px] text-blue-400 uppercase tracking-widest font-black">Total Records</p>
        </div>
      </div>
      
      <div className="overflow-y-auto flex-1 p-4 bg-slate-50">
        {messages.length === 0 ? (
          <div className="text-center p-10 bg-white rounded-xl border border-slate-100">
            <span className="text-5xl mb-4 block">📭</span>
            <p className="text-slate-700 font-black uppercase tracking-widest text-sm">Your inbox is clear.</p>
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">No corporate alerts issued.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg: any) => {
              const isUnread = !msg.is_read;
              const isExpanded = expandedMsgId === msg.id;
              const isBroadcast = msg.subject.includes('BROADCAST');

              return (
                <div 
                  key={msg.id} 
                  onClick={() => handleReadMessage(msg)}
                  className={`border rounded-xl transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-md ${
                    isUnread ? 'bg-white border-blue-300' : 'bg-slate-100 border-slate-200 opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="p-4 flex gap-4 items-start">
                    <div className="shrink-0 mt-1">
                      {isUnread ? (
                        <span className="relative flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-600"></span>
                        </span>
                      ) : (
                        <span className="text-slate-400">✅</span>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className={`text-sm truncate pr-2 ${isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`}>
                          {msg.subject}
                        </h4>
                        <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                          {new Date(msg.created_at).toLocaleDateString('en-IN', {day:'numeric', month:'short'})}
                        </span>
                      </div>
                      
                      {!isExpanded && (
                        <p className="text-xs text-slate-500 truncate font-medium">
                          {msg.body}
                        </p>
                      )}

                      {isBroadcast && !isExpanded && (
                        <span className="inline-block mt-2 text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                          Global Broadcast
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-white animate-in slide-in-from-top-2 duration-200">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          Received: {new Date(msg.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'})}
                        </span>
                        {isBroadcast && (
                          <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                            Global Broadcast
                          </span>
                        )}
                      </div>
                      
                      <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-medium bg-slate-50 p-4 rounded-xl border border-slate-200">
                        {msg.body}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      <div className="bg-slate-100 p-3 border-t border-slate-200 flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-500 shrink-0">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600"></span> Unread Alert</span>
        <span className="flex items-center gap-1">✅ Read & Logged</span>
      </div>
    </div>
  );
}