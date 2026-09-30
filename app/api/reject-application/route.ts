import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Initialize Supabase with Service Key for administrative overrides
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    // =========================================================================
    // 1. CRITICAL SECURITY GATE: Verify the user triggering this API
    // =========================================================================
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing token' }, { status: 401 });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requestingUser }, error: verifyError } = await supabaseAdmin.auth.getUser(token);
    
    if (verifyError || !requestingUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid session' }, { status: 401 });
    }

    // =========================================================================
    // 2. Data Extraction & File Searching
    // =========================================================================
    const { appId, applicantName, applicantEmail, rejectReason } = await request.json();

    if (!appId || !applicantName || !applicantEmail || !rejectReason) {
      return NextResponse.json({ success: false, error: 'Missing required application data' }, { status: 400 });
    }

    // Search the storage bucket for this applicant's files (PDF and Photo)
    const safeName = applicantName.replace(/[^a-zA-Z0-9]/g, '_');
    const { data: files, error: searchError } = await supabaseAdmin.storage
      .from('application_documents')
      .list('', { search: safeName });

    if (searchError) throw searchError;

    // =========================================================================
    // 3. Download KYC Files to Server Memory for Secure Email Attachment
    // =========================================================================
    const attachments = [];
    const filesToDelete = [];
    
    for (const file of files || []) {
      const { data: fileBlob } = await supabaseAdmin.storage.from('application_documents').download(file.name);
      if (fileBlob) {
        const buffer = Buffer.from(await fileBlob.arrayBuffer());
        attachments.push({ filename: file.name, content: buffer });
        filesToDelete.push(file.name);
      }
    }

    const senderEmail = 'updates@fastark.in';

    // =========================================================================
    // 4. Communication Dispatch
    // =========================================================================
    
    // Send Email to the Applicant
    await resend.emails.send({
      from: `Fast Ark Updates <${senderEmail}>`,
      to: applicantEmail,
      subject: 'Update on your Fast Ark Partner Application',
      text: `Dear ${applicantName},\n\nThank you for applying to Fast Ark.\n\nUnfortunately, we are unable to proceed with your application at this time.\n\nReason for decline:\n${rejectReason}\n\nBest Regards,\nFast Ark Back Office`,
    });

    // Send Email to the Admin with Documents attached
    await resend.emails.send({
      from: `Fast Ark System <${senderEmail}>`,
      to: 'ENQUIRY@FASTARK.IN',
      subject: `Declined Application Log: ${applicantName}`,
      text: `Application for ${applicantName} was declined by the Back Office.\n\nReason: ${rejectReason}\n\nThe applicant's submitted KYC documents are attached to this email for your records. The files have been wiped from the database.`,
      attachments: attachments,
    });

    // =========================================================================
    // 5. Data Privacy Wipe & Database Status Update
    // =========================================================================
    
    // Delete the highly sensitive KYC files from the Supabase Storage Bucket
    if (filesToDelete.length > 0) {
      await supabaseAdmin.storage.from('application_documents').remove(filesToDelete);
    }

    // [UPGRADED]: Update the status to 'Rejected' instead of deleting the row. 
    // This keeps the telemetry logs from breaking and allows the UI to show the Rejected badge.
    const { error: updateError } = await supabaseAdmin
      .from('pending_applications')
      .update({ 
        status: 'Rejected',
        reject_reason: rejectReason 
      })
      .eq('id', appId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, message: 'Application rejected, KYC wiped, and emails dispatched.' });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}