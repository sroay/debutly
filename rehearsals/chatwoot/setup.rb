# Run once in the rails container after db:chatwoot_prepare. Skips the first-run screen that makes
# the installation's owner, and turns on public sign-up, which the installation stores in its own
# settings (so the ENABLE_ACCOUNT_SIGNUP variable is not enough after the first start).
Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
signup = InstallationConfig.find_or_initialize_by(name: 'ENABLE_ACCOUNT_SIGNUP')
signup.value = true
signup.locked = false
signup.save!
GlobalConfig.clear_cache
puts "Sign-up enabled: #{GlobalConfigService.account_signup_enabled?}"
