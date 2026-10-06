import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function Page() {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    const { data: users, error } = await supabase.from('users').select()

    if (error) {
        console.error('Error fetching users:', error)
    }

    return (
        <ul>
            {users?.map((user) => (
                <li key={user.id}>{user.email ?? user.name ?? user.id}</li>
            ))}
        </ul>
    )
}
