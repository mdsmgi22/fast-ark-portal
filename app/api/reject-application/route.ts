import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. CRITICAL SECURITY GATE
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Missing token' }, { status: 401 });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requestingUser }, error: verifyError } = await supabaseAdmin.auth.getUser(token);
    
    if (verifyError || !requestingUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid session' }, { status: 401 });
    }

    // 2. Data Extraction
    const { appId, applicantName, applicantEmail, rejectReason } = await request.json();

    if (!appId || !applicantName || !applicantEmail || !rejectReason) {
      return NextResponse.json({ success: false, error: 'Missing required application data' }, { status: 400 });
    }

    const safeName = applicantName.replace(/[^a-zA-Z0-9]/g, '_');
    const { data: files, error: searchError } = await supabaseAdmin.storage
      .from('application_documents')
      .list('', { search: safeName });

    if (searchError) throw searchError;

    // 3. Download KYC Files to Server Memory
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
    const cleanEmail = applicantEmail.trim().toLowerCase();

    // 4. Communication Dispatch
    await resend.emails.send({
      from: `Fast Ark Updates <${senderEmail}>`,
      to: cleanEmail,
      subject: 'Update on your Fast Ark Partner Application',
      text: `Dear ${applicantName},\n\nThank you for applying to Fast Ark.\n\nUnfortunately, we are unable to proceed with your application at this time.\n\nReason for decline:\n${rejectReason}\n\nBest Regards,\nFast Ark Back Office`,
    });

    await resend.emails.send({
      from: `Fast Ark System <${senderEmail}>`,
      to: 'ENQUIRY@FASTARK.IN',
      subject: `Declined Application Log: ${applicantName}`,
      text: `Application for ${applicantName} was declined by the Back Office.\n\nReason: ${rejectReason}\n\nThe applicant's submitted KYC documents are attached to this email for your records. The files have been wiped from the database.`,
      attachments: attachments,
    });

    // 5. Data Privacy Wipe & App Status Update
    if (filesToDelete.length > 0) {
      await supabaseAdmin.storage.from('application_documents').remove(filesToDelete);
    }

    await supabaseAdmin
      .from('pending_applications')
      .update({ status: 'Rejected', reject_reason: rejectReason })
      .eq('id', appId);

    // =========================================================================
    // 6. THE KILL-SWITCH: Sever Ghost Access
    // =========================================================================
    
    // Suspend the database profile aggressively
    await supabaseAdmin
      .from('active_partners')
      .update({ status: 'Suspended' })
      .ilike('email', `%${cleanEmail}%`);

    // Obliterate the Auth User by paginating past the 50-user limit
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
      if (authError || !authData.users || authData.users.length === 0) {
        hasMore = false;
        break;
      }
      
      const targetUser = authData.users.find(u => u.email?.toLowerCase() === cleanEmail);
      if (targetUser) {
        await supabaseAdmin.auth.admin.deleteUser(targetUser.id);
        hasMore = false; 
      } else {
        page++;
      }
    }

    return NextResponse.json({ success: true, message: 'Application rejected, ghost access severed, and emails dispatched.' });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}