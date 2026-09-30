"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "./lib/supabase"; 

export default function FastArkHomePage() {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const { error } = await supabase
      .from('enquiries')
      .insert([
        { name: formData.name, email: formData.email, message: formData.message }
      ]);
  
    if (error) {
      alert("Sorry, there was an error sending your message. " + error.message);
    } else {
      alert("Thank you! Your enquiry has been sent to the Fast Ark team.");
      setFormData({ name: "", email: "", message: "" }); 
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      
      {/* NAVIGATION BAR */}
      <nav className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="text-2xl font-black tracking-wider">FAST ARK.IN</div>
          
          <div className="hidden md:flex space-x-8 items-center font-medium">
            <a href="#about" className="hover:text-blue-400 transition-colors">About Us</a>
            <a href="#contact" className="hover:text-blue-400 transition-colors">Contact Us</a>
            
            {/* UPDATED: Primary Call-to-Action now defaults to the Partner Network */}
            <Link 
              href="/partner/login" 
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-md font-bold transition-all shadow-md flex items-center gap-2"
            >
              Partner Login <span className="text-xl leading-none">&rarr;</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <header className="bg-white py-24 text-center border-b border-gray-200">
        <h1 className="text-5xl font-extrabold text-slate-900 mb-6">
          Welcome to <span className="text-blue-600">Fast Ark</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Delivering high-performance digital solutions and infrastructure for modern businesses.
        </p>
      </header>

      {/* ABOUT US SECTION */}
      <section id="about" className="py-24 max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl font-bold mb-8 text-slate-800">About Us</h2>
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-100">
          <p className="text-lg text-gray-600 leading-relaxed">
            At Fast Ark, we specialize in building robust, scalable web applications designed to streamline your workflows. Our mission is to bridge the gap between complex technology and user-friendly design, ensuring your business stays ahead of the digital curve.
          </p>
        </div>
      </section>

      {/* CONTACT & ENQUIRY FORM SECTION */}
      <section id="contact" className="py-24 bg-slate-100 border-t border-gray-200">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-3xl font-bold mb-8 text-center text-slate-800">Submit an Enquiry</h2>
          
          <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-md space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
              <input 
                type="text" 
                required 
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                placeholder="John Doe"
                value={formData.name} 
                onChange={(e) => setFormData({...formData, name: e.target.value})} 
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
              <input 
                type="email" 
                required 
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                placeholder="john@example.com"
                value={formData.email} 
                onChange={(e) => setFormData({...formData, email: e.target.value})} 
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">How can we help?</label>
              <textarea 
                rows={4} 
                required 
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                placeholder="Tell us about your project or requirements..."
                value={formData.message} 
                onChange={(e) => setFormData({...formData, message: e.target.value})}
              ></textarea>
            </div>
            
            <button 
              type="submit" 
              className="w-full bg-slate-900 text-white p-4 rounded-md font-bold text-lg hover:bg-slate-800 transition-colors shadow-md"
            >
              Send Message
            </button>
          </form>
        </div>
      </section>

      {/* UPDATED: Professional Split Footer */}
      <footer className="bg-slate-900 text-gray-400 py-8 border-t-4 border-blue-600">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm">&copy; {new Date().getFullYear()} Fast Ark Pvt Ltd. All rights reserved.</p>
          
          <div className="flex items-center gap-6">
            <Link href="/apply" className="text-xs uppercase tracking-widest hover:text-white transition">Partner Application</Link>
            {/* The hidden Corporate Command link */}
            <Link href="/login" className="text-[10px] uppercase tracking-widest text-slate-600 hover:text-blue-400 transition font-black">
              Corporate Gateway
            </Link>
          </div>
        </div>
      </footer>

    </div>
  );
}