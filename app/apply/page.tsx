"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export default function ApplicationForm() {
  const router = useRouter();

  const initialFormState = {
    name: "", dob: "", gender: "", gov_id_number: "", pan_number: "", mobile: "", alt_mobile: "",
    email: "", qualification: "", guardian_relation: "Father Name", guardian_name: "", 
    address_1: "", address_2: "", pin_code: "", taluk: "", dist: "", state: "",
    requested_role: "OCSC", center_name: "", terms_accepted: false,
    poi_type: "AADHAAR CARD", poa_type: "AADHAAR CARD", other_type: "PAN CARD"
  };

  const initialFileState = {
    poi: null, poa: null, photo: null, other: null
  };

  const [formData, setFormData] = useState(initialFormState);
  const [files, setFiles] = useState<{ poi: File | null, poa: File | null, photo: File | null, other: File | null }>(initialFileState);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [maxDate, setMaxDate] = useState("");

  useEffect(() => {
    const today = new Date();
    const past18Years = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    setMaxDate(past18Years.toISOString().split("T")[0]);

    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const showError = (errorMsg: string) => {
    setLoading(false);
    setMessage(`❌ ${errorMsg}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePinCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const pin = e.target.value.replace(/[^0-9]/g, '');
    setFormData({ ...formData, pin_code: pin });
    
    if (pin.length === 6) {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        const data = await res.json();
        if (data[0].Status === "Success") {
          const postOffice = data[0].PostOffice[0];
          setFormData(prev => ({
            ...prev,
            taluk: postOffice.Block || postOffice.Region || "",
            dist: postOffice.District || "",
            state: postOffice.State || ""
          }));
        }
      } catch (err) {
        console.error("Error fetching PIN details");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (file.size > 2 * 1024 * 1024) {
        showError(`File size for ${type.toUpperCase()} must be under 2MB. Please select a smaller file.`);
        e.target.value = ''; 
        return;
      }
      
      setFiles(prev => ({ ...prev, [type]: file }));

      if (type === 'photo') {
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        const objectUrl = URL.createObjectURL(file);
        setPhotoPreview(objectUrl);
      }
    }
  };

  const checkDuplicates = async () => {
    if (formData.alt_mobile && formData.mobile === formData.alt_mobile) {
      return "Alternative mobile number cannot be the exact same as your primary mobile number.";
    }

    const queries = [
      supabase.from('pending_applications').select('id').ilike('email', formData.email).limit(1),
      supabase.from('pending_applications').select('id').or(`mobile.eq.${formData.mobile},alt_mobile.eq.${formData.mobile}`).limit(1)
    ];

    if (formData.alt_mobile) {
      queries.push(
        supabase.from('pending_applications').select('id').or(`mobile.eq.${formData.alt_mobile},alt_mobile.eq.${formData.alt_mobile}`).limit(1)
      );
    }

    const results = await Promise.all(queries);

    if (results[0].data && results[0].data.length > 0) return `Duplicate Entry: The Email '${formData.email}' is already registered.`;
    if (results[1].data && results[1].data.length > 0) return `Duplicate Entry: The Primary Mobile '${formData.mobile}' is already registered.`;
    if (formData.alt_mobile && results[2] && results[2].data && results[2].data.length > 0) {
      return `Duplicate Entry: The Alternative Mobile '${formData.alt_mobile}' is already registered.`;
    }

    return null; 
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formElement = e.currentTarget as HTMLFormElement;
    
    setMessage(""); 
    
    if (!formData.name.trim()) return showError("Please enter your Full Name.");
    if (!formData.guardian_name.trim()) return showError("Please enter the Guardian's Name.");
    if (!formData.gender) return showError("Please select your Gender.");
    
    if (!formData.dob) return showError("Please select your Date of Birth from the calendar.");
    const dobDate = new Date(formData.dob);
    if (isNaN(dobDate.getTime())) return showError("Invalid Date format. Please use the calendar picker.");
    const maxAllowedDate = new Date(maxDate);
    if (dobDate > maxAllowedDate) return showError("You must be at least 18 years old to submit this application.");

    if (formData.gov_id_number.length !== 12) return showError("Validation Error: ID Number must be exactly 12 digits.");
    
    if (formData.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.pan_number)) {
      return showError("Validation Error: Invalid PAN Card format. (e.g., ABCDE1234F).");
    }

    if (formData.mobile.length !== 10) return showError("Validation Error: Primary Mobile Number must be exactly 10 digits.");
    if (formData.alt_mobile && formData.alt_mobile.length !== 10) return showError("Validation Error: Alternative Mobile Number must be exactly 10 digits.");
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) return showError("Validation Error: Please enter a valid lowercase Email Address.");

    if (!formData.address_1.trim()) return showError("Please enter Address Line 1.");
    if (formData.pin_code.length !== 6) return showError("Please enter a valid 6-digit PIN Code.");
    if (!formData.center_name.trim()) return showError("Please enter the Requested Center Name / Location.");

    if (!formData.terms_accepted) return showError("You must accept the terms and conditions.");
    if (!files.poi || !files.poa) return showError("Please upload both POI and POA documents.");
    if (!files.photo) return showError("Please upload your Passport Size Photo.");
    
    setLoading(true);
    setMessage("Validating application data...");
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const duplicateErrorMsg = await checkDuplicates();
    if (duplicateErrorMsg) {
      return showError(duplicateErrorMsg); 
    }

    try {
      let userIp = "Unknown";
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        const ipData = await ipRes.json();
        userIp = ipData.ip;
      } catch (ipErr) {
        console.error("Could not fetch IP", ipErr);
      }

      setMessage("Generating A4 Application Form & Merging KYC Documents...");
      
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const trackingFont = boldFont; 
      
      const timestamp = new Date().toLocaleString();

      // =========================================================================
      // 🚀 GENERATE OFFICIAL A4 APPLICATION FORM
      // =========================================================================
      const a4Width = 595.28;
      const a4Height = 841.89;
      const formPage = pdfDoc.addPage([a4Width, a4Height]);
      
      formPage.drawText("FAST ARK - PARTNER APPLICATION FORM", { x: 50, y: 790, size: 16, font: boldFont });
      formPage.drawLine({ start: { x: 50, y: 780 }, end: { x: 545, y: 780 }, thickness: 1 });

      // Embed & Glue Photo to Top Right (FIXED MIME PARSER)
      if (files.photo) {
        try {
          const photoBuffer = await files.photo.arrayBuffer();
          const mimeType = files.photo.type.toLowerCase();
          
          let photoImage;
          if (mimeType.includes('png')) {
            photoImage = await pdfDoc.embedPng(photoBuffer);
          } else {
            photoImage = await pdfDoc.embedJpg(photoBuffer);
          }
          
          formPage.drawImage(photoImage, { x: 445, y: 640, width: 100, height: 125 });
          formPage.drawRectangle({ x: 445, y: 640, width: 100, height: 125, borderColor: rgb(0,0,0), borderWidth: 1 });
        } catch (err) {
          console.error("Error embedding photo to A4:", err);
        }
      }

      // Type out Application Details
      let currentY = 750;
      const drawRow = (label: string, value: string) => {
        formPage.drawText(label, { x: 50, y: currentY, size: 10, font: boldFont });
        formPage.drawText(value || "N/A", { x: 200, y: currentY, size: 10, font: font });
        currentY -= 22;
      };

      drawRow("Application Date:", timestamp);
      drawRow("Applicant Name:", formData.name);
      drawRow(`${formData.guardian_relation}:`, formData.guardian_name);
      drawRow("Gender:", formData.gender.toUpperCase());
      drawRow("Date of Birth:", formData.dob);
      drawRow("Gov ID Number:", "[Redacted]"); // Security masking for document PDF 
      drawRow("PAN Number:", formData.pan_number);
      drawRow("Primary Mobile:", formData.mobile);
      drawRow("Alt Mobile:", formData.alt_mobile);
      drawRow("Email Address:", formData.email);
      drawRow("Qualification:", formData.qualification.toUpperCase());
      
      currentY -= 15;
      formPage.drawText("ADDRESS DETAILS", { x: 50, y: currentY, size: 12, font: boldFont });
      currentY -= 25;
      drawRow("Address Line 1:", formData.address_1);
      drawRow("Address Line 2:", formData.address_2);
      drawRow("PIN Code:", formData.pin_code);
      drawRow("Taluk & District:", `${formData.taluk}, ${formData.dist}`);
      drawRow("State:", formData.state);

      currentY -= 15;
      formPage.drawText("ROLE & CENTER REQUEST", { x: 50, y: currentY, size: 12, font: boldFont });
      currentY -= 25;
      drawRow("Requested Role:", formData.requested_role);
      drawRow("Requested Center:", formData.center_name.toUpperCase());

      // Form Page Footer
      const formStampText = `APP: ${formData.name.toUpperCase()} | DOC: SYSTEM GENERATED FORM | FILE: A4_APPLICATION.PDF | IP: ${userIp} | TIME: ${timestamp}`;
      formPage.drawRectangle({ x: 0, y: 0, width: a4Width, height: 20, color: rgb(0, 0, 0) });
      formPage.drawText(formStampText, { x: 10, y: 6, size: 7, font: boldFont, color: rgb(1, 1, 1) });


      // =========================================================================
      // 🚀 APPEND KYC DOCUMENTS BEHIND THE A4 FORM
      // =========================================================================
      const fileArray = [
        { file: files.poi, label: `POI: ${formData.poi_type}` },
        { file: files.poa, label: `POA: ${formData.poa_type}` },
      ];
      
      if (files.other) {
        fileArray.push({ file: files.other, label: `OTHER: ${formData.other_type}` });
      }

      for (const { file, label } of fileArray) {
        if (!file) continue;
        
        try {
          const arrayBuffer = await file.arrayBuffer();
          const stampText = `APP: ${formData.name.toUpperCase()} | DOC: ${label} | FILE: ${file.name.toUpperCase()} | IP: ${userIp} | TIME: ${timestamp}`;

          const fileNameLower = file.name.toLowerCase();
          const mimeType = file.type ? file.type.toLowerCase() : "";
          
          const isPdf = mimeType.includes('pdf') || fileNameLower.endsWith('.pdf');
          const isJpg = mimeType.includes('jpeg') || mimeType.includes('jpg') || fileNameLower.endsWith('.jpg') || fileNameLower.endsWith('.jpeg');
          const isPng = mimeType.includes('png') || fileNameLower.endsWith('.png');

          if (isPdf) {
            const loadedPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
            const copiedPages = await pdfDoc.copyPages(loadedPdf, loadedPdf.getPageIndices());
            
            copiedPages.forEach((page) => {
              pdfDoc.addPage(page);
              const { width } = page.getSize();
              page.drawRectangle({ x: 0, y: 0, width: width, height: 20, color: rgb(0, 0, 0) });
              page.drawText(stampText, { x: 10, y: 6, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
            });

          } else if (isJpg || isPng) {
            let image = isJpg ? await pdfDoc.embedJpg(arrayBuffer) : await pdfDoc.embedPng(arrayBuffer);
            
            let { width, height } = image;
            const maxWidth = 595.28; 
            if (width > maxWidth) {
              const ratio = maxWidth / width;
              width = maxWidth;
              height = height * ratio;
            }

            const page = pdfDoc.addPage([width, height + 25]);
            page.drawImage(image, { x: 0, y: 25, width: width, height: height });
            page.drawRectangle({ x: 0, y: 0, width: width, height: 25, color: rgb(0, 0, 0) });
            page.drawText(stampText, { x: 10, y: 8, size: 7, font: trackingFont, color: rgb(1, 1, 1) });
          } else {
            console.warn(`Skipped unsupported file type: ${file.name}`);
          }
        } catch (mergeError) {
          console.error(`Merge Failed on ${label}:`, mergeError);
          return showError(`Failed to process document: ${file.name}. Ensure it is a valid PDF, JPG, or PNG.`);
        }
      }

      const mergedPdfBytes = await pdfDoc.save();
      const safeName = formData.name.replace(/[^a-zA-Z0-9]/g, '_');
      const pdfFileName = `${safeName}_${Date.now()}_KYC.pdf`;

      setMessage("Uploading secure KYC PDF...");
      const { error: uploadError } = await supabase.storage
        .from('application_documents')
        .upload(pdfFileName, mergedPdfBytes, { contentType: 'application/pdf' });
      
      if (uploadError) throw uploadError;

      setMessage("Uploading pristine passport photo...");
      let savedPhotoPath = null;
      
      if (files.photo) {
        const fileExt = files.photo.name.split('.').pop();
        const photoFileName = `${safeName}_${Date.now()}_PHOTO.${fileExt}`;
        
        const { error: photoUploadError, data: photoData } = await supabase.storage
          .from('application_documents')
          .upload(photoFileName, files.photo, { contentType: files.photo.type });
          
        if (photoUploadError) throw photoUploadError;
        savedPhotoPath = photoData.path; 
      }

      setMessage("Saving application record...");
      const combinedGuardian = `${formData.guardian_relation}: ${formData.guardian_name}`;

      const { error: dbError } = await supabase
        .from('pending_applications')
        .insert([{
           name: formData.name, dob: formData.dob, gender: formData.gender, gov_id_number: formData.gov_id_number,
           mobile: formData.mobile, alt_mobile: formData.alt_mobile, email: formData.email,
           qualification: formData.qualification, father_name: combinedGuardian,
           address_1: formData.address_1, address_2: formData.address_2, pin_code: formData.pin_code,
           taluk: formData.taluk, dist: formData.dist, state: formData.state,
           requested_role: formData.requested_role, center_name: formData.center_name,
           terms_accepted: formData.terms_accepted,
           ip_address: userIp,
           photo_path: savedPhotoPath 
        }]);
      
      if (dbError) {
        if (dbError.code === '23505') {
          return showError("Database Block: A record with this Email or Mobile already exists securely in the database.");
        }
        throw dbError; 
      }

      setFormData(initialFormState);
      setFiles(initialFileState);
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null); 
      formElement.reset(); 
      
      setMessage("✅ Thank you. Your application has been successfully submitted to the Fast Ark Back Office.");
      
      router.refresh();
      setTimeout(() => setMessage(""), 8000); 

    } catch (error: any) {
      console.error("Submission Error:", error);
      showError(error.message || "An unexpected error occurred during submission.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-12 px-4 sm:px-6">
      
      {/* 1. TOP ESCAPE HATCH: Clear exit path before engaging with the form */}
      <div className="max-w-6xl mx-auto mb-4">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-500 font-black tracking-widest uppercase text-xs hover:text-blue-600 transition bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200">
          <span>&larr;</span> Return to Main Website
        </Link>
      </div>

      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="bg-slate-900 p-6 text-white">
          <h1 className="text-3xl font-black">Partner Application Form</h1>
          <p className="text-slate-300 mt-2">Submit your details and KYC documents below.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-8 space-y-10 text-slate-800">
          
          {message && (
            <div className={`p-4 rounded-md font-bold text-center border shadow-sm transition-all duration-300 ${message.startsWith("❌") ? "bg-red-50 text-red-800 border-red-200" : message.startsWith("✅") ? "bg-green-50 text-green-800 border-green-200" : "bg-blue-50 text-blue-800 border-blue-200"} text-lg`}>
              {message}
            </div>
          )}

          {/* PERSONAL DETAILS & PHOTO UPLOAD */}
          <div>
            <h2 className="text-xl font-bold border-b pb-2 mb-6">Personal Details</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <input 
                  required 
                  placeholder="Full Name (Max 45 Letters) *" 
                  maxLength={45}
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value.replace(/[^A-Za-z\s]/g, '').toUpperCase()})} 
                />
                
                <div className="flex gap-2">
                  <select className="border p-3 rounded bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500 w-1/3" value={formData.guardian_relation} onChange={e => setFormData({...formData, guardian_relation: e.target.value})}>
                    <option value="Father Name">Father Name</option>
                    <option value="Mother Name">Mother Name</option>
                    <option value="Guardian">Guardian</option>
                    <option value="Husband Name">Husband Name</option>
                  </select>
                  <input 
                    required 
                    placeholder="Name (Max 45 Letters) *" 
                    maxLength={45}
                    className="border p-3 rounded flex-1 outline-none focus:ring-2 focus:ring-blue-500" 
                    value={formData.guardian_name} 
                    onChange={e => setFormData({...formData, guardian_name: e.target.value.replace(/[^A-Za-z\s]/g, '').toUpperCase()})} 
                  />
                </div>

                <select 
                  required 
                  className="border p-3 rounded bg-white outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.gender} 
                  onChange={e => setFormData({...formData, gender: e.target.value})}
                >
                  <option value="">Select Gender... *</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Transgender">Transgender</option>
                  <option value="Other">Other</option>
                </select>

                <input 
                  required 
                  type="text" 
                  placeholder="Select Date of Birth (Must be 18+) *" 
                  onFocus={(e) => e.target.type = 'date'}
                  onBlur={(e) => { if (!e.target.value) e.target.type = 'text'; }}
                  max={maxDate}
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.dob} 
                  onChange={e => setFormData({...formData, dob: e.target.value})} 
                />
                
                <input 
                  required 
                  placeholder="Gov ID No. (12 Digits) *" 
                  type="text" 
                  maxLength={12} 
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.gov_id_number} 
                  onChange={e => { 
                    let val = e.target.value.replace(/[^0-9]/g, ''); 
                    if (val.startsWith('0')) val = val.substring(1); 
                    setFormData({...formData, gov_id_number: val}); 
                  }} 
                />
                
                <input 
                  placeholder="PAN Number (Optional)" 
                  type="text" 
                  maxLength={10} 
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500 uppercase" 
                  value={formData.pan_number} 
                  onChange={e => setFormData({...formData, pan_number: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()})} 
                />
                
                <input 
                  required 
                  placeholder="Primary Mobile Number *" 
                  type="tel" 
                  maxLength={10} 
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.mobile} 
                  onChange={e => { let val = e.target.value.replace(/[^0-9]/g, ''); if (val.startsWith('0')) val = val.substring(1); setFormData({...formData, mobile: val}); }} 
                />
                
                <input 
                  placeholder="Alternative Mobile Number" 
                  type="tel" 
                  maxLength={10} 
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.alt_mobile} 
                  onChange={e => { let val = e.target.value.replace(/[^0-9]/g, ''); if (val.startsWith('0')) val = val.substring(1); setFormData({...formData, alt_mobile: val}); }} 
                />
                
                <input 
                  required 
                  placeholder="Email Address *" 
                  type="email" 
                  className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" 
                  value={formData.email} 
                  onChange={e => setFormData({...formData, email: e.target.value.toLowerCase().trim()})} 
                />
                
                <select required className="border p-3 rounded bg-white outline-none focus:ring-2 focus:ring-blue-500" value={formData.qualification} onChange={e => setFormData({...formData, qualification: e.target.value})}>
                  <option value="">Select Qualification... *</option>
                  <option value="10th">10th</option>
                  <option value="12th">12th</option>
                  <option value="Graduate">Graduate</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="lg:col-span-1">
                <div className="bg-slate-50 p-6 border border-blue-200 rounded-xl shadow-sm h-full flex flex-col items-center justify-center text-center">
                  <label className="block font-black text-slate-800 mb-2">Passport Photo (MANDATORY)</label>
                  <p className="text-xs text-blue-600 font-bold mb-4 px-2">
                    Upload a clear photograph with a WHITE background.
                  </p>
                  
                  {photoPreview ? (
                    <img 
                      src={photoPreview} 
                      alt="Passport Preview" 
                      className="w-32 h-40 object-cover rounded-md border-4 border-white shadow-lg mb-4"
                    />
                  ) : (
                    <div className="w-32 h-40 bg-white border-2 border-dashed border-gray-300 rounded-md flex items-center justify-center text-gray-400 text-sm mb-4 shadow-sm">
                      No Photo
                    </div>
                  )}
                  
                  <input 
                    type="file" 
                    accept=".jpg, .jpeg, .png" 
                    required 
                    onChange={e => handleFileChange(e, 'photo')} 
                    className="w-full bg-white border p-2 rounded cursor-pointer font-medium text-sm" 
                  />
                </div>
              </div>

            </div>
          </div>

          {/* ADDRESS & LOCATION */}
          <div>
            <h2 className="text-xl font-bold border-b pb-2 mb-4">Address Details</h2>
            <div className="grid grid-cols-1 gap-4 mb-4">
              <input required placeholder="Address Line 1 (Max 60 Letters) *" maxLength={60} className="border p-3 rounded w-full outline-none focus:ring-2 focus:ring-blue-500" value={formData.address_1} onChange={e => setFormData({...formData, address_1: e.target.value.toUpperCase()})} />
              <input placeholder="Address Line 2 (Max 60 Letters)" maxLength={60} className="border p-3 rounded w-full outline-none focus:ring-2 focus:ring-blue-500" value={formData.address_2} onChange={e => setFormData({...formData, address_2: e.target.value.toUpperCase()})} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <input required placeholder="PIN Code *" maxLength={6} className="border p-3 rounded bg-blue-50 font-bold outline-none focus:ring-2 focus:ring-blue-500" value={formData.pin_code} onChange={handlePinCodeChange} />
              <input required placeholder="Taluk" readOnly className="border p-3 rounded bg-gray-50 text-gray-600 cursor-not-allowed" value={formData.taluk} />
              <input required placeholder="District" readOnly className="border p-3 rounded bg-gray-50 text-gray-600 cursor-not-allowed" value={formData.dist} />
              <input required placeholder="State" readOnly className="border p-3 rounded bg-gray-50 text-gray-600 cursor-not-allowed" value={formData.state} />
            </div>
          </div>

          {/* ROLE SELECTION */}
          <div>
            <h2 className="text-xl font-bold border-b pb-2 mb-4">Role & Center Request</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select className="border p-3 rounded font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" value={formData.requested_role} onChange={e => setFormData({...formData, requested_role: e.target.value})}>
                <option value="OCSC">OCSC</option>
                <option value="AADHAAR CENTER">AADHAAR CENTER</option>
                <option value="CM (CONSUMER MOBILITY)">CM (CONSUMER MOBILITY)</option>
                <option value="PARTNER">PARTNER</option>
                <option value="IRCTC AGENT">IRCTC AGENT</option>
              </select>
              <input required placeholder="Requested Center Name / Location *" className="border p-3 rounded outline-none focus:ring-2 focus:ring-blue-500" value={formData.center_name} onChange={e => setFormData({...formData, center_name: e.target.value})} />
            </div>
            {formData.requested_role === "IRCTC AGENT" && (
              <p className="text-red-600 text-sm font-bold mt-2 border-l-4 border-red-600 pl-3">
                WARNING: Ensure your ID, Email, and Mobile are NOT blacklisted by IRCTC.
              </p>
            )}
          </div>

          {/* KYC DOCUMENT UPLOADS */}
          <div>
            <h2 className="text-xl font-bold border-b pb-2 mb-4">KYC Documents (Max 2MB each)</h2>
            <div className="space-y-4 bg-slate-50 p-6 rounded-lg border">
              
              <div>
                <label className="block font-bold mb-1">1. Proof of Identity (POI) - Mandatory</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select className="border p-2 rounded bg-white w-full sm:w-64 outline-none focus:ring-2 focus:ring-blue-500 font-medium" value={formData.poi_type} onChange={e => setFormData({...formData, poi_type: e.target.value})}>
                    <option value="AADHAAR CARD">AADHAAR CARD</option>
                    <option value="PAN CARD">PAN CARD</option>
                    <option value="DRIVING LICENCE">DRIVING LICENCE</option>
                    <option value="PASSPORT">PASSPORT</option>
                  </select>
                  <input type="file" accept=".pdf, .jpg, .jpeg, .png" required onChange={e => handleFileChange(e, 'poi')} className="flex-1 bg-white border p-2 rounded cursor-pointer" />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">2. Proof of Address (POA) - Mandatory</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select className="border p-2 rounded bg-white w-full sm:w-64 outline-none focus:ring-2 focus:ring-blue-500 font-medium" value={formData.poa_type} onChange={e => setFormData({...formData, poa_type: e.target.value})}>
                    <option value="AADHAAR CARD">AADHAAR CARD</option>
                    <option value="DRIVING LICENCE">DRIVING LICENCE</option>
                    <option value="PASSPORT">PASSPORT</option>
                  </select>
                  <input type="file" accept=".pdf, .jpg, .jpeg, .png" required onChange={e => handleFileChange(e, 'poa')} className="flex-1 bg-white border p-2 rounded cursor-pointer" />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-600">3. Other Documents - Non Mandatory</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select className="border p-2 rounded bg-white w-full sm:w-64 outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-600" value={formData.other_type} onChange={e => setFormData({...formData, other_type: e.target.value})}>
                    <option value="PAN CARD">PAN CARD</option>
                    <option value="OTHER DOCUMENTS">OTHER DOCUMENTS</option>
                  </select>
                  <input type="file" accept=".pdf, .jpg, .jpeg, .png" onChange={e => handleFileChange(e, 'other')} className="flex-1 bg-white border p-2 rounded cursor-pointer" />
                </div>
              </div>

            </div>
          </div>

          {/* TERMS AND CONDITIONS */}
          <div>
            <h2 className="text-xl font-bold border-b pb-2 mb-4">Terms & Conditions</h2>
            <div className="h-48 overflow-y-scroll bg-gray-50 border p-5 text-sm text-gray-700 mb-4 rounded shadow-inner space-y-3">
              <p><strong>1. Allotment Rights:</strong> Fast Ark Private Limited reserves the sole and absolute right to approve, allot, or decline the IRCTC Agent ID creation upon review of applicant credentials and compliance documents.</p>
              <p><strong>2. Non-Refundable Policy:</strong> Any application processing fee or commercial charges deposited are strictly non-refundable under all circumstances once submitted.</p>
              <p><strong>3. Commercial Terms:</strong> The authorized commission structure and operational commercial guidelines will be shared upon successful verification and ID issuance.</p>
              <p className="uppercase font-bold text-slate-900 border-t border-gray-300 pt-2 mt-2">4. I ACCEPT ALL THE TERMS AND CONDITIONS AND FOLLOWS THE SOP FOR THE AS PER THE COMPANY NORMS AND IF I FAIL TO DO THE SO COMPANY IS HAVING ALL THE RIGHTS TO TAKE UP THE ACTION AS PER THE NORMS. LEGAL JURISDICTION IS BANGLAORE, KARNATAKA.</p>
            </div>
            <label className="flex items-center space-x-3 cursor-pointer bg-blue-50 p-4 rounded border border-blue-200">
              <input type="checkbox" required className="w-6 h-6 text-blue-600 rounded focus:ring-blue-500" checked={formData.terms_accepted} onChange={e => setFormData({...formData, terms_accepted: e.target.checked})} />
              <span className="font-black text-slate-800">I ACCEPT ALL THE TERMS AND CONDITIONS AND FOLLOW THE SOP</span>
            </label>
          </div>

          {/* 2. BOTTOM ESCAPE HATCH: Cancel button added alongside submit */}
          <div className="flex flex-col sm:flex-row gap-4 mt-2">
            <button 
              type="button"
              onClick={() => router.push('/')}
              disabled={loading}
              className="w-full sm:w-1/3 bg-slate-200 text-slate-700 p-5 rounded-md font-black text-xl hover:bg-slate-300 transition-colors shadow-sm disabled:opacity-50"
            >
              Cancel & Return
            </button>
            <button 
              type="submit" 
              disabled={loading} 
              className="w-full sm:w-2/3 bg-blue-600 text-white p-5 rounded-md font-black text-xl hover:bg-blue-700 transition-colors shadow-lg disabled:bg-slate-400"
            >
              {loading ? "Processing Securely..." : "Submit Application"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}