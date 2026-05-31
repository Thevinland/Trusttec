import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentification requise' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Token invalide ou expiré' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .in('role', ['admin', 'super_admin'])

    let isBootstrapping = !(count && count > 0)

    if (!isBootstrapping) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile || profile.role !== 'super_admin') {
        return new Response(JSON.stringify({ error: 'Seul un super admin peut créer un administrateur' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const { email, password, full_name } = await req.json()

    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ error: 'Champs obligatoires manquants' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Le mot de passe doit faire au moins 6 caractères' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newRole = isBootstrapping ? 'super_admin' : 'admin'

    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: newRole },
    })

    if (createError) throw createError

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: newRole, full_name, must_change_password: true })
      .eq('id', authUser.user.id)

    if (profileError) {
      console.error('Profile update with must_change_password failed, retrying without:', profileError.message)
      const { error: fallbackError } = await supabase
        .from('profiles')
        .update({ role: newRole, full_name })
        .eq('id', authUser.user.id)
      if (fallbackError) throw fallbackError
    }

    if (!isBootstrapping) {
      await supabase.rpc('log_admin_created', {
        creator_id: user.id,
        new_admin_id: authUser.user.id,
        new_admin_name: full_name,
      }).then(({ error: logErr }) => {
        if (logErr) console.error('Failed to log admin creation:', logErr)
      })
    }

    return new Response(JSON.stringify({ success: true, user: { id: authUser.user.id, email, full_name, role: newRole } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
