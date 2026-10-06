"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "./lib/supabase"; 

export default function FastArkHomePage() {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });
  const [isScrolled, setIsScrolled] = useState(false);

  // Smooth navbar transition on scroll
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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

  const scrollTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-600 selection:text-white">
      
      {/* NAVIGATION BAR */}
      <nav className={`fixed w-full top-0 z-50 transition-all duration-300 ${isScrolled ? 'bg-slate-900 shadow-xl py-3' : 'bg-slate-900/95 py-5 backdrop-blur-sm'}`}>
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          
          {/* Logo Block */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-lg flex items-center justify-center transform rotate-12 shadow-lg">
              <span className="text-white font-black text-2xl -rotate-12 italic">F</span>
            </div>
            <div>
              <span className="text-2xl font-black tracking-wider text-white">FAST <span className="text-emerald-500">ARK</span></span>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-0.5">Rejuvenating Business</p>
            </div>
          </div>
          
          <div className="hidden md:flex space-x-8 items-center font-bold text-sm tracking-wide text-slate-300">
            <button onClick={() => scrollTo('about')} className="hover:text-white transition-colors">About Us</button>
            <button onClick={() => scrollTo('services')} className="hover:text-white transition-colors">Services</button>
            <button onClick={() => scrollTo('leadership')} className="hover:text-white transition-colors">Leadership</button>
            <button onClick={() => scrollTo('contact')} className="hover:text-white transition-colors">Contact</button>
            
            <Link 
              href="/partner/login" 
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg font-black transition-all shadow-lg hover:shadow-blue-600/30 flex items-center gap-2 border border-blue-500"
            >
              Partner Login <span>&rarr;</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <header className="relative pt-40 pb-32 overflow-hidden bg-slate-900 text-white">
        <div className="absolute inset-0 z-0 opacity-20 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-600 via-slate-900 to-emerald-900"></div>
        <div className="max-w-7xl mx-auto px-6 relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-4 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              ISO 9001:2015 Certified | MSME Registered
            </div>
            <h1 className="text-5xl lg:text-7xl font-black leading-tight tracking-tight">
              Delivering <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                Digital Excellence.
              </span>
            </h1>
            <p className="text-lg lg:text-xl text-slate-400 font-medium leading-relaxed max-w-2xl mx-auto lg:mx-0">
              Established in 2021, Fast Ark specializes in highly scalable IT solutions, massive eGovernance operations, and specialized telecom infrastructure across India.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <button onClick={() => scrollTo('services')} className="bg-white text-slate-900 px-8 py-4 rounded-xl font-black shadow-xl hover:bg-slate-100 transition transform hover:-translate-y-1">
                Explore Our Services
              </button>
              <button onClick={() => scrollTo('contact')} className="bg-slate-800 text-white border border-slate-700 px-8 py-4 rounded-xl font-black shadow-lg hover:bg-slate-700 transition">
                Get in Touch
              </button>
            </div>
          </div>
          
          <div className="hidden lg:grid grid-cols-2 gap-6 relative">
            <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700 p-6 rounded-2xl shadow-2xl transform translate-y-12 transition hover:-translate-y-2 hover:border-blue-500 duration-300">
              <div className="text-4xl mb-4">🇮🇳</div>
              <h3 className="font-black text-xl mb-1">Pan-India Scale</h3>
              <p className="text-slate-400 text-sm font-medium">Over 200+ active centers across Karnataka, Maharashtra, UP, and West Bengal.</p>
            </div>
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-2xl shadow-2xl transition hover:-translate-y-2 duration-300">
              <div className="text-4xl mb-4 text-blue-200">📊</div>
              <h3 className="font-black text-xl mb-1 text-white">High Volume Ops</h3>
              <p className="text-blue-100 text-sm font-medium">Executing 2 Crore+ Aadhaar enrollments and robust BSNL telecom operations.</p>
            </div>
          </div>
        </div>
      </header>

      {/* ABOUT US & VISION/MISSION SECTION */}
      <section id="about" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            
            <div>
              <h2 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">Empowering Citizens at their Doorstep.</h2>
              <p className="text-lg text-slate-600 leading-relaxed mb-10 font-medium">
                At Fast Ark Private Limited, we bridge the gap between complex technology and everyday convenience. Our mission is to build robust, scalable web applications and e-governance solutions designed to streamline workflows and keep your business ahead of the digital curve.
              </p>
              
              <div className="space-y-8">
                <div className="flex gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center text-2xl shrink-0 shadow-sm">👁️</div>
                  <div>
                    <h4 className="font-black text-xl text-slate-900 mb-2">Our Vision</h4>
                    <p className="text-sm text-slate-600 font-medium leading-relaxed">To make the ordinary citizen an honorable citizen by way of ICT enabled application & services delivery at Citizen's door step.</p>
                  </div>
                </div>
                <div className="flex gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center text-2xl shrink-0 shadow-sm">🎯</div>
                  <div>
                    <h4 className="font-black text-xl text-slate-900 mb-2">Our Mission</h4>
                    <p className="text-sm text-slate-600 font-medium leading-relaxed">To be a niche player of e-governance solutions in IT enabled Citizen Centric Applications development and services delivery. To be a respected player in e-governance Applications and portal services.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-slate-50 rounded-3xl p-8 text-center border border-slate-200 shadow-sm hover:border-blue-300 transition">
                <p className="text-5xl font-black text-blue-600 mb-3">200+</p>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Aadhaar Centers</p>
              </div>
              <div className="bg-slate-50 rounded-3xl p-8 text-center border border-slate-200 shadow-sm mt-12 hover:border-emerald-300 transition">
                <p className="text-5xl font-black text-emerald-500 mb-3">150+</p>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">BSNL OCSC Units</p>
              </div>
              <div className="bg-slate-50 rounded-3xl p-8 text-center border border-slate-200 shadow-sm hover:border-purple-300 transition">
                <p className="text-5xl font-black text-purple-600 mb-3">2Cr+</p>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Enrollments Done</p>
              </div>
              <div className="bg-slate-50 rounded-3xl p-8 text-center border border-slate-200 shadow-sm mt-12 hover:border-amber-300 transition">
                <p className="text-5xl font-black text-amber-500 mb-3">₹10Cr</p>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500">Revenue Managed</p>
              </div>
            </div>
            
          </div>
        </div>
      </section>

      {/* SERVICES PORTFOLIO SECTION */}
      <section id="services" className="py-24 bg-slate-50 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">Our Service Verticals</h2>
            <p className="text-lg text-slate-500 font-medium">We deploy specialized teams across multiple sectors, handling high-volume operational tasks for government and corporate clients.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition hover:-translate-y-1">
              <div className="w-14 h-14 bg-blue-50 border border-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm">🆔</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">Aadhaar Enrollment</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">Partnering with BSNL to manage centers and executing massive national population registry projects across India.</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition hover:-translate-y-1">
              <div className="w-14 h-14 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm">🎧</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">Customer Support (OCSC)</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">Managing Outsourced Customer Support Centers for BSNL across Karnataka, AP, TN, Maharashtra, and Gujarat.</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition hover:-translate-y-1">
              <div className="w-14 h-14 bg-purple-50 border border-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm">📡</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">Telecom Infrastructure</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">Authorized Consumer Mobility Franchisee and FTTH (Fiber to the Home) installation partners for BSNL.</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition hover:-translate-y-1">
              <div className="w-14 h-14 bg-amber-50 border border-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm">🏛️</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">eGovernance Solutions</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">Custom G2C portals for municipality tax collection and vast bulk scanning/digitization services for state departments.</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg transition hover:-translate-y-1">
              <div className="w-14 h-14 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm">👥</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">Manpower Deployment</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">Providing specialized technical staff and highly trained support operators for Gramin Banks and large enterprise networks.</p>
            </div>

            <div className="bg-slate-900 p-8 rounded-2xl shadow-lg border border-slate-800 text-white relative overflow-hidden group">
              <div className="absolute -right-10 -top-10 w-40 h-40 bg-blue-600 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition duration-500"></div>
              <div className="w-14 h-14 bg-slate-800 border border-slate-700 text-blue-400 rounded-xl flex items-center justify-center text-3xl mb-6 relative z-10 shadow-sm">💳</div>
              <h3 className="text-xl font-black mb-3 relative z-10">B2B Fintech: PAYBULL.IN</h3>
              <p className="text-slate-400 text-sm font-medium leading-relaxed mb-6 relative z-10">
                Our proprietary digital platform supporting 150+ agents handling mobile recharges, BBPS, domestic money transfers, and IRCTC bookings.
              </p>
              <a href="http://www.paybull.in" target="_blank" rel="noreferrer" className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest px-6 py-2.5 rounded-lg transition relative z-10 shadow-md">Visit Platform &rarr;</a>
            </div>

          </div>
        </div>
      </section>

      {/* LEADERSHIP & MANAGEMENT SECTION */}
      <section id="leadership" className="py-24 bg-slate-900 text-white border-t-8 border-blue-600">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-4xl font-black mb-4 tracking-tight">Our Management Team</h2>
            <p className="text-lg text-slate-400 font-medium">Guided by decades of expertise in IT, project management, and large-scale e-governance implementations.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 text-center hover:border-blue-500 transition duration-300 shadow-xl hover:-translate-y-2">
              <div className="w-24 h-24 bg-slate-700 border-4 border-slate-600 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl shadow-inner">👨🏽‍💼</div>
              <h3 className="text-xl font-black mb-1">Subhransu Sekhar Pani</h3>
              <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest mb-4 bg-blue-900/30 inline-block px-3 py-1 rounded-full border border-blue-800">Director</p>
              <p className="text-sm text-slate-400 font-medium leading-relaxed">24 years of rich experience in Project Management, Business Development, Telecom, Resource Management, Quality Control, and high-level eGovernance Execution.</p>
            </div>

            <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 text-center hover:border-emerald-500 transition duration-300 shadow-xl hover:-translate-y-2">
              <div className="w-24 h-24 bg-slate-700 border-4 border-slate-600 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl shadow-inner">👨🏽‍‍💼</div>
              <h3 className="text-xl font-black mb-1">Mohamed Suleman N</h3>
              <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-4 bg-emerald-900/30 inline-block px-3 py-1 rounded-full border border-emerald-800">Chief Operating Officer</p>
              <p className="text-sm text-slate-400 font-medium leading-relaxed">20 years of expertise in Banking Services, ITES, eGovernance Operations, and heading PAN-India management of massive Aadhaar enrollment deployments.</p>
            </div>

            <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 text-center hover:border-purple-500 transition duration-300 shadow-xl hover:-translate-y-2">
              <div className="w-24 h-24 bg-slate-700 border-4 border-slate-600 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl shadow-inner">👩🏽‍💼</div>
              <h3 className="text-xl font-black mb-1">Mariyappa Sumithra</h3>
              <p className="text-[10px] text-purple-400 font-black uppercase tracking-widest mb-4 bg-purple-900/30 inline-block px-3 py-1 rounded-full border border-purple-800">Director</p>
              <p className="text-sm text-slate-400 font-medium leading-relaxed">Overseeing general operations, enterprise scaling, and leading the Office and Financial Administration for the entire organization.</p>
            </div>
          </div>
          
          <div className="mt-16 pt-10 border-t border-slate-800">
            <h3 className="text-center text-sm font-black text-slate-500 uppercase tracking-widest mb-8">Trusted Strategic Partners</h3>
            <div className="flex flex-wrap justify-center gap-10 md:gap-16 items-center opacity-60 grayscale hover:grayscale-0 transition duration-500">
              <div className="text-2xl font-black text-blue-400">BSNL</div>
              <div className="text-xl font-black text-slate-300">Promena LLP</div>
              <div className="text-lg font-black text-slate-300">Shanmukha Electricals</div>
              <div className="text-lg font-black text-slate-300">Kalleshwara Industries</div>
            </div>
          </div>
        </div>
      </section>

      {/* CONTACT & ENQUIRY FORM SECTION */}
      <section id="contact" className="py-24 bg-slate-100 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16">
          
          <div>
            <h2 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">Submit an Enquiry</h2>
            <p className="text-slate-600 mb-10 text-lg font-medium">Whether you're looking for operational partnerships or interested in joining our growing team, we'd love to hear from you.</p>
            
            <div className="space-y-6">
              <div className="flex gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl shrink-0">📍</div>
                <div>
                  <h4 className="font-black text-sm text-slate-900 uppercase tracking-widest mb-2">Registered Office</h4>
                  <p className="text-slate-600 font-bold leading-relaxed text-sm">
                    45, VP ROAD, BAHUBALI NAGAR,<br />
                    BANGALORE 560013,<br />
                    Karnataka, India
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl shrink-0">📞</div>
                <div>
                  <h4 className="font-black text-sm text-slate-900 uppercase tracking-widest mb-2">Contact Details</h4>
                  <p className="text-slate-600 font-bold text-sm leading-relaxed">
                    080-2728 7199<br/>
                    +91 79751 50453<br/>
                    <a href="mailto:fastark.in@gmail.com" className="text-blue-600 hover:underline mt-1 inline-block">fastark.in@gmail.com</a>
                  </p>
                </div>
              </div>

              <div className="flex gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl shrink-0">💼</div>
                <div>
                  <h4 className="font-black text-sm text-slate-900 uppercase tracking-widest mb-2">Careers</h4>
                  <p className="text-slate-600 font-bold text-sm">
                    Submit your resume to:<br/>
                    <a href="mailto:openings.fastark@gmail.com" className="text-blue-600 hover:underline">openings.fastark@gmail.com</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200 shadow-xl h-fit">
            <h3 className="font-black text-2xl text-slate-900 mb-8 border-b border-slate-100 pb-4">Drop us a Message</h3>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Full Name *</label>
                <input 
                  type="text" 
                  required 
                  className="w-full p-4 border-2 border-slate-200 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-800 transition-all bg-slate-50 focus:bg-white" 
                  placeholder="e.g. John Doe"
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Email Address *</label>
                <input 
                  type="email" 
                  required 
                  className="w-full p-4 border-2 border-slate-200 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-800 transition-all bg-slate-50 focus:bg-white" 
                  placeholder="john@example.com"
                  value={formData.email} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">How can we help? *</label>
                <textarea 
                  rows={4} 
                  required 
                  className="w-full p-4 border-2 border-slate-200 rounded-xl focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none font-medium text-slate-800 transition-all bg-slate-50 focus:bg-white" 
                  placeholder="Tell us about your project or requirements..."
                  value={formData.message} 
                  onChange={(e) => setFormData({...formData, message: e.target.value})}
                ></textarea>
              </div>
              
              <button 
                type="submit" 
                className="w-full bg-slate-900 text-white p-4 rounded-xl font-black uppercase tracking-widest text-sm hover:bg-blue-600 transition-all shadow-lg hover:shadow-blue-600/30 transform hover:-translate-y-0.5 mt-4"
              >
                Send Secure Message
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 text-slate-400 pt-16 pb-8 border-t-4 border-blue-600">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12 border-b border-slate-800 pb-12">
            <div className="lg:col-span-2">
              <span className="text-2xl font-black tracking-wider text-white block mb-2">FAST ARK</span>
              <p className="text-sm font-medium leading-relaxed max-w-sm mb-4">
                Delivering high-performance digital solutions, eGovernance services, and highly scalable telecom infrastructure across India.
              </p>
              <p className="text-[10px] uppercase tracking-widest font-black text-slate-600 bg-slate-900 inline-block px-3 py-1 rounded border border-slate-800">
                CIN: U74999KA2021PTC152803
              </p>
            </div>

            <div>
              <h4 className="text-white font-black uppercase tracking-widest text-sm mb-4">Quick Links</h4>
              <ul className="space-y-3 text-sm font-bold">
                <li><button onClick={() => scrollTo('about')} className="hover:text-blue-400 transition">About Us</button></li>
                <li><button onClick={() => scrollTo('services')} className="hover:text-blue-400 transition">Our Services</button></li>
                <li><Link href="/apply" className="hover:text-blue-400 transition">Partner Application</Link></li>
                <li><Link href="/login" className="hover:text-blue-400 transition">Corporate Gateway</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-black uppercase tracking-widest text-sm mb-4">Portals</h4>
              <ul className="space-y-3 text-sm font-bold">
                <li><a href="http://www.paybull.in" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition">Paybull B2B Network</a></li>
                <li><Link href="/partner/login" className="hover:text-blue-400 transition">Franchise Login</Link></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-medium text-slate-600">
            <p>&copy; {new Date().getFullYear()} Fast Ark Private Limited. All rights reserved. Registered with MSME.</p>
            <p className="font-bold tracking-wide">
              Designed and developed by <span className="text-slate-400 font-black">FAPL Architect (MSN)</span>
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}