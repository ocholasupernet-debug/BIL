  <strong style={{ color: "#fff", fontSize: 14 }}>{hotspotCredentials.password}</strong>
                              </div>
                            </div>
                          )}
                        {!accessReady && (
                          <div className="hp-setup-steps" aria-label="Account setup progress">
                            <div className="hp-setup-step" data-state="done"><span className="hp-setup-step-mark"><CheckCircle2 size={14} /></span>Payment confirmed</div>
                            <div className="hp-setup-step" data-state="active"><span className="hp-setup-step-mark"><Loader2 size={13} style={{ animation: "spin 1.2s linear infinite" }} /></span>Preparing your hotspot account</div>
                            <div className="hp-setup-step" data-state="pending"><span className="hp-setup-step-mark"><Wifi size={13} /></span>Connecting this device</div>
                          </div>
                        )}
                        <div className="hp-connected-badge" style={{ marginTop: 16, marginBottom: 24 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399" }} />
                            {accessReady ? "Connected" : portalHandoffReady ? "Connecting" : loyaltyPaidWithPoints ? "Points redeemed" : "Payment received"}
                        </div>
                          {!accessReady && payError && (
                            <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 16 }}>{payError}</p>
                          )}
                        {mpesaStatus?.shortcode && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16 }}>
                            Daraja shortcode: {mpesaStatus.shortcode} {mpesaStatus.env === "sandbox" ? "(Sandbox)" : ""}
                          </p>
                        )}
                        {isTvMode && tvDiagnostic && (
                          <div
                            className="hp-troubleshoot-status"
                            data-tone={tvDiagnostic.connected ? "active" : tvDiagnostic.status === "package_expired" || tvDiagnostic.status === "package_depleted" || tvDiagnostic.status === "package_inactive" ? "help" : "warning"}
                            role="status"
                            aria-live="polite"
                            style={{ margin: "0 auto 16px", maxWidth: 420, textAlign: "left" }}
                          >
                            <div className="hp-troubleshoot-status-heading">
                              <span className="hp-troubleshoot-status-mark" aria-hidden="true">
                                {tvDiagnostic.connected ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
                              </span>
                              <strong>{tvPackageDiagnosticTitle(tvDiagnostic.status)}</strong>
                            </div>
                            {tvDiagnostic.planName && (
                              <p className="hp-troubleshoot-status-copy" style={{ marginBottom: 4 }}>
                                Package: <strong>{tvDiagnostic.planName}</strong>
                              </p>
                            )}
                            <p className="hp-troubleshoot-status-copy">{tvDiagnostic.message}</p>
                            {tvDiagnostic.paymentStatus === "paid" && (
                              <div className="hp-troubleshoot-session-meta">
                                <div><span>TV MAC</span><strong>{normalizeMacAddress(deviceMacAddress) || "Unavailable"}</strong></div>
                                <div><span>Router</span><strong>{tvDiagnostic.routerReachable === true ? "Reachable" : tvDiagnostic.routerReachable === false ? "Unavailable" : "Not checked"}</strong></div>
                                <div><span>TV on hotspot</span><strong>{tvDiagnostic.deviceVisible === true ? "Detected" : tvDiagnostic.deviceVisible === false ? "Not detected" : "Not checked"}</strong></div>
                                <div><span>Hotspot session</span><strong>{tvDiagnostic.connected ? "Confirmed" : "Not confirmed"}</strong></div>
                                {tvDiagnostic.expiresAt && (
                                  <div><span>Package expiry</span><strong>{formatSessionExpiry(tvDiagnostic.expiresAt)}</strong></div>
                                )}
                              </div>
                            )}
                            {tvDiagnostic.retryAvailable && (
                              <div className="hp-troubleshoot-note">
                                Retrying uses this same payment and TV account; it will not create another username.
                              </div>
                            )}
                          </div>
                        )}
                        {isTvMode && (
                          <button
                            type="button"
                            className="hp-btn hp-btn-ghost"
                            disabled={tvDiagnosticLoading || accessRetrying}
                            style={{ width: "auto", display: "inline-flex", padding: "10px 24px", margin: "0 6px 10px" }}
                            onClick={() => void checkTvPackageStatus()}
                          >
                            {tvDiagnosticLoading
                              ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Checking TV…</>
                              : <><Tv size={15} /> Check TV package</>}
                          </button>
                        )}
                        {isTvMode && checkoutId && (
                          <button
                            type="button"
                            className="hp-btn hp-btn-ghost"
                            disabled={accessRetrying || tvDiagnosticLoading}
                            style={{ width: "auto", display: "inline-flex", padding: "10px 24px", margin: "0 6px 10px" }}
                            onClick={retryExistingPaidAccess}
                          >
                            {accessRetrying
                              ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Reconnecting…</>
                              : <><Wifi size={15} /> Reconnect this TV</>}
                          </button>
                        )}
                        <button className="hp-btn hp-btn-ghost" disabled={accessRetrying || portalHandoffReady || (isTvMode && tvDiagnosticLoading)} style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => {
                            const destination = portalContext.linkOrig || portalContext.linkLogin;
                            if (accessReady && isTvMode) {
                              setShowTvSuccess(true);
                              return;
                            }
                            if (accessReady && /^https?:\/\//i.test(destination)) window.location.assign(destination);
                            else retryExistingPaidAccess();
                          }}>
                          {accessReady ? (isTvMode ? "Show login confirmation" : "Continue online")
                            : portalHandoffReady ? "Connecting…"
                              : accessRetrying ? "Retrying connection…"
                                : isTvMode ? "Retry TV sign-in" : "Retry connection"}
                        </button>
                      </>
                    ) : paymentFailed ? (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "2px solid rgba(245,158,11,0.22)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <AlertCircle size={30} color="#fbbf24" strokeWidth={2} />
                        </div>
                        <h3>Payment Not Completed</h3>
                        <p>The M-Pesa prompt was cancelled or declined. No payment was confirmed and your plan has not been activated.</p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 20 }}>Check M-Pesa before retrying if you believe the amount was deducted.</p>
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                          onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setLoyaltyPaidWithPoints(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          Try Again
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--isp-accent-glow)", border: "2px solid var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                          <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1.5s linear infinite" }} />
                        </div>
                        <h3>{payError ? "Connecting your device" : "Waiting for Payment"}</h3>
                        <p>An STK push has been sent to <strong style={{ color: "#fff" }}>{phone}</strong></p>
                        {payError && <p style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>{payError}</p>}
                        <p style={{ fontSize: 13, marginBottom: 4 }}>
                          Enter your PIN on your phone to pay <strong style={{ color: "#34d399" }}>{getCurrencySymbol()} {selectedPlan?.price}</strong>
                        </p>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
                          {mpesaStatus?.shortcode && <>Daraja shortcode: {mpesaStatus.shortcode} &middot; </>}
                          {mpesaStatus?.env === "sandbox" ? "Sandbox Mode" : "Live Payment"}
                        </p>
                        {pollTimedOut ? (
                          <div style={{ padding: 14, borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)", marginBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, textAlign: "center" }}>
                            <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                            <p style={{ margin: 0 }}>Payment not confirmed yet. If you already entered your PIN, it may take a moment to process.</p>
                            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Try again or contact support if the amount was deducted.</p>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 24, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                            <Loader2 size={12} style={{ animation: "spin 2s linear infinite" }} />
                            Checking payment status...
                          </div>
                        )}
                        <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                           onClick={() => { setStkSent(false); setSelectedPlan(null); setPhone(""); setCheckoutId(null); setPaymentConfirmed(false); setLoyaltyPaidWithPoints(false); setAccessReady(false); setPaymentFailed(false); setPollTimedOut(false); bindingInFlight.current = false; }}>
                          {pollTimedOut ? "Try Again" : "Cancel & Start Over"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                   ) : (
                <>
                   <div className="hp-purchase-hero">
                     <div>
                       <div className="hp-kicker">{isTvMode ? "TV CONNECT" : "HOTSPOT ACCESS"}</div>
                       <h2 className="hp-purchase-title">{isTvMode ? "Bring streaming to life." : "Pick your perfect plan."}</h2>
                       <p className="hp-purchase-copy">{isTvMode ? "Choose a plan for your smart TV or streaming device. Pay from your phone and connect instantly." : "Simple packages, instant activation, and no contracts. Choose a plan and get online in seconds."}</p>
                     </div>
                     <div className="hp-purchase-icon">
                       {isTvMode ? <Tv size={27} strokeWidth={1.8} /> : <Sparkles size={27} strokeWidth={1.8} />}
                     </div>
                   </div>
                    <div className="hp-tv-purchase-actions">
                      <button type="button" className="hp-tv-trigger" onClick={openTvDialog}>
                        <Tv size={15} /> Connect to TV
                      </button>
                      <button
                        type="button"
                        className="hp-tv-paid-trigger"
                        onClick={() => void openTvTroubleshooting(tvMacAddress)}
                      >
                        <Wifi size={15} /> Already paid? Reconnect TV
                      </button>
                    </div>
                   <div className="hp-trust-row">
                     <div className="hp-trust-item"><CheckCircle2 size={14} /> Instant access</div>
                     <div className="hp-trust-item"><Shield size={14} /> Secure payment</div>
                     <div className="hp-trust-item"><Zap size={14} /> No contracts</div>
                   </div>
                  {plansLoading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                      <Loader2 size={28} color="var(--isp-accent)" style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  ) : plans.length === 0 ? (
                    <p className="hp-empty-plans" style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: "48px 0", fontSize: 14 }}>
                      No packages are configured for this hotspot.
                    </p>
                  ) : (
                    <div className={`hp-plans-grid${selectedPlan ? " has-expanded" : ""}`}>
                      {plans.map((plan, i) => {
                        const planGradients = portalBranding.portalLayout === "classic"
                          || (!portalBranding.portalLayout && HOTSPOT_RUNTIME_CONFIG.portalLayout === "classic")
                          ? GUEST_PLAN_GRADIENTS
                          : PLAN_GRADIENTS;
                        const grad = planGradients[i % planGradients.length];
                         const isExpanded = !isDanstedLayout && selectedPlan?.id === plan.id;
                         const isCollapsed = !isDanstedLayout && selectedPlan && !isExpanded;
                        const dataLimitLabel = formatHotspotDataAllowance(plan);
                        const sharedDevicesLabel = formatHotspotSharedDevices(plan.shared_users);
                        return (
                          <div key={plan.id}
                            className={`hp-plan${isExpanded ? " expanded" : ""}${isCollapsed ? " collapsed" : ""}`}
                            style={isExpanded ? { borderColor: grad.light + "44", boxShadow: `0 4px 32px ${grad.light}15` } : {}}>

                            <div className="hp-plan-accent" style={{ background: grad.bg }} />

                            {isExpanded ? (
                              <div className="hp-plan-body">
                                <div className="hp-plan-top" onClick={() => setSelectedPlan(null)} style={{ padding: 0, marginBottom: 4 }}>
                                  <div>
                                    <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                    <div className="hp-plan-price" style={{ marginBottom: 6 }}>
                                      <span>{getCurrencySymbol()} </span>{plan.price}
                                    </div>
                                  </div>
                                  <div className="hp-plan-check" style={{ background: grad.bg }}>
                                    <CheckCircle2 size={12} color="#fff" strokeWidth={3} />
                                  </div>
                                </div>
                                <div className="hp-plan-inline-meta" style={{ marginBottom: 0 }}>
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                  <div className="hp-plan-meta-row">
                                    <Database size={12} color={grad.light} /> {dataLimitLabel}
                                  </div>
                                  <div className="hp-plan-meta-row">
                                    <Users size={12} color={grad.light} /> {sharedDevicesLabel}
                                  </div>
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>

                                <div className="hp-plan-pay">
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      {isPaymentMethodReady(mpesaStatus)
                                        ? <Phone size={14} color="#22c55e" />
                                        : <AlertCircle size={14} color="#f59e0b" />}
                                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                                        {isPaymentMethodReady(mpesaStatus)
                                          ? `${isTvMode ? "Pay for TV with" : "Pay with"} ${checkoutPaymentLabel(mpesaStatus?.paymentGateway ?? "")}`
                                          : HOTSPOT_RUNTIME_CONFIG.previewOnly
                                            ? "Checkout is disabled in preview"
                                            : mpesaStatus ? "Payment method is not configured" : "Payment status will be checked at checkout"}
                                      </span>
                                    </div>
                                    {mpesaStatus && isPaymentMethodReady(mpesaStatus) && (
                                      <span style={{
                                        fontSize: 10, fontWeight: 700,
                                        padding: "3px 8px", borderRadius: 6,
                                          background: "rgba(52,211,153,0.1)",
                                          color: "#34d399",
                                          border: "1px solid rgba(52,211,153,0.2)",
                                      }}>
                                         {mpesaStatus.env === "sandbox" ? "SANDBOX" : "LIVE"}
                                      </span>
                                    )}
                                  </div>

                                  {!isPaymentMethodReady(mpesaStatus) && (
                                    <div style={{
                                      padding: 10, borderRadius: 10, textAlign: "center", marginBottom: 12,
                                      background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
                                      fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
                                    }}>
                                      <AlertCircle size={16} color="#f59e0b" style={{ marginBottom: 6 }} />
                                      <p style={{ margin: 0 }}>
                                        {HOTSPOT_RUNTIME_CONFIG.previewOnly
                                          ? "Payment checkout is disabled in preview."
                                          : mpesaStatus
                                          ? "This service has no configured payment method. The payment service will confirm availability."
                                          : "Payment status could not be confirmed. You can continue; the payment service will verify checkout."}
                                      </p>
                                    </div>
                                  )}
                                  {payLoading ? (
                                    <div className="hp-checkout-progress" role="status" aria-live="polite">
                                      <div className="hp-checkout-orbit"><Phone size={25} /></div>
                                      <strong>Preparing your M-Pesa prompt</strong>
                                      <p>Keep this page open. We’re securely starting your payment request.</p>
                                      <span>Elapsed <b>{String(Math.floor(paymentElapsedSeconds / 60)).padStart(2, "0")}:{String(paymentElapsedSeconds % 60).padStart(2, "0")}</b></span>
                                    </div>
                                  ) : HOTSPOT_RUNTIME_CONFIG.previewOnly ? (
                                    <div style={{
                                      padding: 12, borderRadius: 10, textAlign: "center",
                                      background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)",
                                      fontSize: 12,
                                    }}>
                                      Payment actions are disabled in the local preview.
                                    </div>
                                  ) : <form onSubmit={handlePay}>
                                    <div className="hp-input-group">
                                      <div className="hp-input-wrap">
                                        <input className="hp-input hp-input-phone" type="tel"
                                          inputMode="tel" placeholder="07XX XXX XXX or 01XX XXX XXX (for M-Pesa)" required={effectiveLoyaltyPayment !== "points"}
                                          value={phone} onChange={e => setPhone(e.target.value)} />
                                      </div>
                                    </div>

                                    {(loyaltyQuoteLoading || loyaltyQuote || loyaltyQuoteError) && (
                                      <div style={{ margin: "0 0 12px", padding: "11px 12px", borderRadius: 10, background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.78)", fontSize: 12 }}>
                                        {loyaltyQuoteLoading ? (
                                          <div role="status" style={{ display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Checking loyalty balance…</div>
                                        ) : loyaltyQuote ? (
                                          <>
                                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                              <span>Your points balance</span><strong style={{ color: "#9fe0be" }}>{new Intl.NumberFormat("en-KE").format(loyaltyQuote.balance)} points</strong>
                                            </div>
                                            {loyaltyRedeemable && loyaltyQuote.pointsRequired && (
                                              <div style={{ marginTop: 10, display: "grid", gap: 7 }}>
                                                <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "9px 10px", borderRadius: 8, border: effectiveLoyaltyPayment === "points" ? "1px solid rgba(117,220,169,.55)" : "1px solid rgba(255,255,255,.12)", background: effectiveLoyaltyPayment === "points" ? "rgba(67,160,112,.12)" : "transparent" }}>
                                                  <input type="radio" name="hotspot-payment-choice" value="points" checked={effectiveLoyaltyPayment === "points"} onChange={() => setLoyaltyPayment("points")} />
                                                  <span>Redeem <strong>{new Intl.NumberFormat("en-KE").format(loyaltyQuote.pointsRequired)} points</strong> for this full plan</span>
                                                </label>
                                                {mpesaCheckoutAvailable && <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "9px 10px", borderRadius: 8, border: effectiveLoyaltyPayment === "mpesa" ? "1px solid rgba(117,220,169,.55)" : "1px solid rgba(255,255,255,.12)", background: effectiveLoyaltyPayment === "mpesa" ? "rgba(67,160,112,.12)" : "transparent" }}>
                                                  <input type="radio" name="hotspot-payment-choice" value="mpesa" checked={effectiveLoyaltyPayment === "mpesa"} onChange={() => setLoyaltyPayment("mpesa")} />
                                                  <span>Pay KSh {plan.price} with M-Pesa</span>
                                                </label>}
                                              </div>
                                            )}
                                            {effectiveLoyaltyPayment === "points" && (
                                              <p style={{ margin: "9px 0 0", color: "rgba(255,255,255,.68)", lineHeight: 1.45 }}>
                                                Redeem to assign your Hotspot account automatically. No username or password is needed.
                                              </p>
                                            )}
                                          </>
                                        ) : (
                                          <div role="status" style={{ display: "flex", gap: 7, alignItems: "flex-start", lineHeight: 1.45 }}>
                                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1, color: "#f5bf69" }} />
                                            <span>Points could not be checked. You can still continue with M-Pesa checkout.</span>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {payError && (
                                      <div className="hp-error" role="alert" style={{ borderColor: "rgba(248, 113, 113, .55)", background: "rgba(127, 29, 29, .28)", color: "#fecaca" }}>
                                        <XCircle size={16} style={{ flexShrink: 0, marginTop: 1, color: "#f87171" }} />
                                        <span><strong>Oops 😞.</strong> {payError}</span>
                                      </div>
                                    )}

                                    <button type="submit" disabled={effectiveLoyaltyPayment === "points"
                                      ? loyaltyRedeemLoading || !(loyaltyRedeemable || pendingLoyaltyCheckout)
                                      : payLoading || !canAttemptHotspotCheckout(mpesaStatus, HOTSPOT_RUNTIME_CONFIG.previewOnly)} className="hp-btn hp-btn-mpesa">
                                      {effectiveLoyaltyPayment === "points" ? loyaltyRedeemLoading ? (
                                        <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Redeeming points…</>
                                      ) : (
                                        <><CheckCircle2 size={16} /> {pendingLoyaltyCheckout ? "Finish access setup" : `Redeem ${loyaltyQuote?.pointsRequired ?? 0} points`}</>
                                      ) : payLoading ? (
                                        <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Sending STK Push...</>
                                      ) : (
                                        <><Phone size={16} /> Pay {getCurrencySymbol()} {plan.price}{isTvMode ? " for TV" : ""}</>
                                      )}
                                    </button>
                                  </form>}

                                     <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                                    <div className="hp-secured" style={{ margin: 0 }}>
                                      <Shield size={11} />
                                      {isPaymentMethodReady(mpesaStatus)
                                        ? mpesaStatus?.paymentGateway === "bank_stk_push"
                                          ? <>Bank STK Push &middot; Safaricom Daraja</>
                                          : mpesaStatus?.paymentGateway === "mpesa_till_push" && mpesaStatus.hasTillNumber
                                            ? <>Buy Goods &amp; Services Till &middot; Safaricom Daraja</>
                                            : mpesaStatus?.shortcode
                                              ? <>Daraja shortcode {mpesaStatus.shortcode} &middot; Safaricom Daraja</>
                                              : <>Secured by Safaricom M-Pesa</>
                                        : mpesaStatus
                                          ? <>Payment method not configured</>
                                          : paymentStatusLoaded
                                            ? <>Payment service will verify checkout</>
                                            : <>Payment status checked at checkout</>}
                                    </div>
                                      <button className="hp-plan-change" onClick={() => { setSelectedPlan(null); setPhone(""); setPayError(null); }}>
                                      <ArrowRight size={12} style={{ transform: "rotate(180deg)" }} /> Change plan
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                             <div className="hp-plan-body" onClick={() => selectPlan(plan)} style={{ cursor: "pointer" }}>
                                <div className="hp-plan-name" style={{ color: grad.light }}>{plan.name}</div>
                                <div className="hp-plan-price">
                                  <span>{getCurrencySymbol()} </span>{plan.price}
                                </div>
                                <div className="hp-plan-meta">
                                  <div className="hp-plan-meta-row">
                                    <Clock size={12} color={grad.light} /> {formatValidity(plan)}
                                  </div>
                                   <div className="hp-plan-meta-row">
                                     <Database size={12} color={grad.light} /> {dataLimitLabel}
                                   </div>
                                   <div className="hp-plan-meta-row">
                                     <Users size={12} color={grad.light} /> {sharedDevicesLabel}
                                   </div>
                                  {plan.speed_down > 0 && (
                                    <div className="hp-plan-meta-row">
                                      <Zap size={12} color={grad.light} /> {formatSpeed(plan.speed_down)}
                                    </div>
                                  )}
                                </div>
                                  {!isDanstedLayout && <div className="hp-plan-action">
                                    <span>{isTvMode ? "Choose for TV" : "Choose plan"}</span>
                                    <ArrowUpRight size={15} />
                                  </div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {loyaltyCardSettings.position === "after-packages" && loyaltyBalanceCard}

          {/* ── VOUCHER ── */}
          {portalCards.voucher && activeTab === "voucher" && (
            <div className="hp-section">
              <div className="hp-glass">
                <div className="hp-glass-header">
                  <div className="hp-glass-icon" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)" }}>
                    <Ticket size={16} color="#fbbf24" />
                  </div>
                  <div>
                    <div className="hp-glass-title">Redeem Voucher</div>
                    <div className="hp-glass-desc">Enter your phone number and voucher code</div>
                  </div>
                </div>
                <div className="hp-glass-body">
                  {voucherSuccess ? (
                    <div className="hp-success">
                      <div className="hp-success-icon">
                        <CheckCircle2 size={32} color="#34d399" strokeWidth={2} />
                      </div>
                      <h3>Voucher activated successfully</h3>
                      {voucherPlanName && (
                        <p>Plan: <strong style={{ color: "#fff" }}>{voucherPlanName}</strong></p>
                      )}
                      {voucherDuration && (
                        <p style={{ marginBottom: 16 }}>Duration: <strong style={{ color: "#fff" }}>{voucherDuration}</strong></p>
                      )}
                      <div className="hp-connected-badge">
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: voucherConnected ? "#34d399" : "#fbbf24" }} />
                        {voucherConnected ? "Connected to the internet" : "Connection pending"}
                      </div>
                      {voucherCredentials && (
                        <p style={{ margin: "12px 0", color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                          Voucher username: <strong style={{ color: "#fff" }}>{voucherCredentials.username}</strong>
                        </p>
                      )}
                      {voucherError && (
                        <div className="hp-error" role="alert" style={{ margin: "12px 0" }}>
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {voucherError}
                        </div>
                      )}
                      {!voucherConnected && (
                        <button type="button" className="hp-btn hp-btn-voucher" disabled={voucherLoading}
                          onClick={() => void retryVoucherConnection()}>
                          {voucherLoading
                            ? <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Connecting...</>
                            : <><Wifi size={16} /> Retry connection</>}
                        </button>
                      )}
                      <br />
                      <button className="hp-btn hp-btn-ghost" style={{ width: "auto", display: "inline-flex", padding: "10px 24px" }}
                        onClick={() => {
                          setVoucherSuccess(false);
                          setVoucherConnected(false);
                          setVoucherCode("");
                          setVoucherInfo(null);
                          setVoucherCredentials(null);
                          setVoucherAccountAdminId(null);
                          setVoucherError("");
                        }}>
                        Redeem Another
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleVoucher}>
                      <div className="hp-voucher-hint">
                        <Ticket size={20} color="#fbbf24" style={{ marginBottom: 6 }} />
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
                          Enter the phone number for the account and the code from your voucher card
                        </p>
                      </div>

                      {voucherError && (
                        <div className="hp-error">
                          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                          {voucherError}
                        </div>
                      )}

                      <div className="hp-input-group">
                        <input className="hp-input" type="tel"
                          placeholder="Phone number (07… or 2547…)" required inputMode="tel" autoComplete="tel"
                          aria-label="Phone number for voucher account"
                          value={voucherPhone} onChange={e => setVoucherPhone(e.target.value)} />
                      </div>
                      <div className="hp-input-group">
                        <input className="hp-input hp-voucher-input" type="text"
                          placeholder="Voucher code (e.g. HYT46)" required minLength={3} maxLength={32}
                          pattern="[A-Za-z0-9-]{3,32}" title="Enter the voucher code without spaces."
                          autoComplete="off" autoCapitalize="characters" aria-label="Voucher code"
                          value={voucherCode} onChange={e => setVoucherCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, "").toUpperCase())} />
                      </div>
                      <p style={{ margin: "-4px 0 12px", color: "rgba(255,255,255,0.48)", fontSize: 11, lineHeight: 1.45 }}>
                        Each permitted redemption creates its own prepaid login. A used or expired voucher cannot be reused.
                      </p>

                      <button type="submit" disabled={voucherLoading} className="hp-btn hp-btn-voucher">
                        {voucherLoading ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Validating...</>
                        ) : (
                          <><ArrowRight size={16} /> Activate Voucher</>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {portalCards.connectionSupport && (
          <div className="hp-troubleshoot-card" style={{ maxWidth: 840, margin: "14px auto 12px" }}>
            <div className="hp-troubleshoot-card-copy">
              <div className="hp-troubleshoot-card-icon" aria-hidden="true"><Wifi size={20} /></div>
              <div>
                <div className="hp-troubleshoot-eyebrow">Connection support</div>
                <h3>Having trouble connecting?</h3>
                <p>{loginSession?.status === "active" && !loginSession.connected
                  ? "Your package is active, but the router has not confirmed sign-in. Tap below to retry."
                  : "We’ll check your package and attempt sign-in automatically. If the router does not confirm it, you can retry."}</p>
              </div>
            </div>
            <button
              ref={troubleshootTriggerRef}
              type="button"
              className="hp-troubleshoot-card-action"
              aria-haspopup="dialog"
              aria-expanded={troubleshootDialogOpen}
              onClick={() => setTroubleshootDialogOpen(true)}
            >
              <Wifi size={15} /> {loginSession?.status === "active" && !loginSession.connected ? "Retry sign-in" : "Troubleshoot connection"} <ArrowRight size={15} />
            </button>
          </div>
          )}

          {portalCards.paymentRecovery && (
            <div style={{ maxWidth: 840, margin: "0 auto 20px" }}>
              {mpesaReconnectCard}
            </div>
          )}

          {troubleshootDialogOpen && (
            <div
              className="hp-troubleshoot-overlay"
              role="presentation"
              onMouseDown={event => {
                if (event.target === event.currentTarget) setTroubleshootDialogOpen(false);
              }}
            >
              <div
                ref={troubleshootDialogRef}
                id="hp-troubleshoot-dialog"
                className="hp-troubleshoot-dialog"
                data-state="open"
                role="dialog"
                aria-modal="true"
                aria-labelledby="hp-troubleshoot-dialog-title"
                aria-describedby="hp-troubleshoot-dialog-description"
                tabIndex={-1}
              >
                <div className="hp-troubleshoot-dialog-ambient" aria-hidden="true" />
                <button
                  type="button"
                  className="hp-troubleshoot-close"
                  aria-label="Close troubleshooting"
                  onClick={() => setTroubleshootDialogOpen(false)}
                >
                  ×
                </button>
                <div className="hp-troubleshoot-dialog-inner">
                  <div className="hp-troubleshoot-dialog-head">
                    <div className="hp-troubleshoot-dialog-icon" aria-hidden="true"><Wifi size={21} /></div>
                    <div>
                      <div className="hp-troubleshoot-dialog-kicker">Connection assistant</div>
                      <h2 id="hp-troubleshoot-dialog-title" className="hp-troubleshoot-dialog-title">Troubleshoot connection</h2>
                      <p id="hp-troubleshoot-dialog-description" className="hp-troubleshoot-dialog-description">
                        We’ll check your package and attempt sign-in automatically. If the router does not confirm it, you can retry.
                      </p>
                    </div>
                  </div>

                  <div className="hp-troubleshoot-device">
                    <span className="hp-troubleshoot-device-label">Checking this device</span>
                    <strong>{portalContext.mac || "Device MAC unavailable"}</strong>
                  </div>

                  {troubleshootLoading ? (
                    <div className="hp-troubleshoot-loading" role="status" aria-live="polite">
                      <span className="hp-troubleshoot-loading-icon">
                        <Loader2 size={21} style={{ animation: "spin 1s linear infinite" }} />
                      </span>
                      <span>{troubleshootAction === "login" ? "Asking the router to log in…" : "Checking your package and router…"}</span>
                    </div>
                  ) : troubleshootError ? (
                    <div className="hp-troubleshoot-error" role="alert">
                      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{troubleshootError}</span>
                    </div>
                  ) : troubleshootStatus && loginSession ? (
                    <div className="hp-troubleshoot-result" role="status" aria-live="polite">
                      <div className="hp-troubleshoot-status" data-tone={troubleshootStatusTone}>
                        <div className="hp-troubleshoot-status-heading">
                          <span className="hp-troubleshoot-status-mark" aria-hidden="true">
                            {loginSession.status === "active" && loginSession.connected
                              ? <CheckCircle2 size={17} />
                              : <AlertCircle size={17} />}
                          </span>
                          <strong>{loginSession.connected ? "Connected" : troubleshootStatus.label}</strong>
                        </div>
                        {loginSession.planName && (
                          <p className="hp-troubleshoot-status-copy" style={{ marginBottom: 4 }}>
                            Package: <strong>{loginSession.planName}</strong>
                          </p>
                        )}
                        <p className="hp-troubleshoot-status-copy">{troubleshootStatus.detail}</p>
                        {loginSession.status === "active" && (
                          <div className="hp-troubleshoot-session-meta">
                            {loginSession.username && (
                              <div><span>Hotspot account</span><strong>{loginSession.username}</strong></div>
                            )}
                            <div><span>Router session</span><strong>{loginSession.connected ? "Confirmed" : "Login required"}</strong></div>
                          </div>
                        )}
                        {troubleshootMessage && <div className="hp-troubleshoot-note">{troubleshootMessage}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="hp-troubleshoot-note" role="status">
                      {troubleshootMessage || "The connection check result will appear here."}
                    </div>
                  )}

                  <div className="hp-troubleshoot-modal-actions">
                    {loginSession?.status === "active" && !loginSession.connected && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={handlePlanLogin}
                        disabled={troubleshootLoading}
                      >
                        {troubleshootLoading
                          ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Logging in…</>
                          : <><Wifi size={15} /> {troubleshootMessage ? "Retry sign-in" : "Sign in now"}</>}
                      </button>
                    )}
                    {(loginSession?.status === "expired" || loginSession?.status === "depleted" || loginSession?.status === "not_found") && (
                      <button
                        type="button"
                        className="hp-troubleshoot-modal-action primary"
                        onClick={() => {
                          setTroubleshootDialogOpen(false);
                          window.setTimeout(() => document.getElementById("hp-plan-tabs")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
                        }}
                      >
                        <CreditCard size={15} /> Browse packages
                      </button>
                    )}
                    <button
                      type="button"
                      className="hp-troubleshoot-modal-action"
                      onClick={handleTroubleshoot}
                      disabled={troubleshootLoading}
                    >
                      {troubleshootLoading
                        ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Checking…</>
                        : <><ArrowRight size={15} /> Check again</>}
                    </button>
                  </div>
                  <p className="hp-troubleshoot-modal-footnote">Package details are matched to this device’s MAC address.</p>
                </div>
              </div>
            </div>
          )}

          {tvDialogOpen && (
            <div className="hp-modal-backdrop" role="presentation">
              <div className="hp-tv-modal" role="dialog" aria-modal="true" aria-labelledby="connect-tv-title">
                <div className="hp-tv-modal-head">
                  <div>
                    <h3 id="connect-tv-title">Connect to TV</h3>
                    <p>Add a TV or streaming device, choose its package, and pay securely with M-Pesa.</p>
                  </div>
                  <button type="button" className="hp-tv-modal-close" onClick={() => setTvDialogOpen(false)} aria-label="Close">×</button>
                </div>
                <form className="hp-tv-modal-body" onSubmit={handleTvBindPay}>
                  {savedTvDevices.length > 0 && (
                    <div className="hp-tv-field">
                      <label className="hp-tv-label">SAVED ON THIS BROWSER</label>
                      <div className="hp-tv-device-list" aria-label="Saved devices on this browser">
                        {savedTvDevices.map(device => (
                          <div className="hp-tv-device-row" key={`saved-${device.macAddress}`}>
                            <Tv size={14} color="#34d399" />
                            {renamingTvDeviceMac === device.macAddress ? (
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <input
                                  className="hp-tv-input"
                                  aria-label={`New name for ${device.name}`}
                                  value={renamingTvDeviceName}
                                  onChange={e => setRenamingTvDeviceName(e.target.value)}
                                  maxLength={64}
                                  autoFocus
                                />
                                <div className="hp-tv-device-actions" style={{ marginTop: 6 }}>
                                  <button type="button" className="hp-tv-device-action" onClick={() => handleSaveRenamedTvDevice(device)}>Save name</button>
                                  <button type="button" className="hp-tv-device-action" onClick={() => {
                                    setRenamingTvDeviceMac("");
                                    setRenamingTvDeviceName("");
                                  }}>Cancel</button>
                                </div>
                                <span>{device.macAddress}</span>
                              </div>
                            ) : (
                              <>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <strong>{device.name}</strong>
                                  <span>{device.macAddress}</span>
                                </div>
                                <div className="hp-tv-device-actions">
                                  <button
                                    type="button"
                                    className="hp-tv-device-action"
                                    onClick={() => handleUseSavedTvDevice(device)}
                                  >
                                    Use
                                  </button>
                                  <button
                                    type="button"
                                    className="hp-tv-device-action"
                                    onClick={() => handleStartRenameSavedTvDevice(device)}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    className="hp-tv-device-action"
                                    onClick={() => handleForgetSavedTvDevice(device)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="hp-tv-help">Saved devices stay in this browser. You can rename or remove them here.</div>
                    </div>
                  )}

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-connected-device">CONNECTED DEVICES</label>
                    <select
                      id="tv-connected-device"
                      className="hp-tv-select"
                      value={tvDeviceChoice}
                      onChange={e => handleTvDeviceChoice(e.target.value)}
                    >
                      <option value="">Add a TV manually</option>
                      {savedTvDevices.map(device => (
                        <option key={`saved-option-${device.macAddress}`} value={device.macAddress}>
                          {device.name} — {device.macAddress} · Saved
                        </option>
                      ))}
                      {tvDevices.filter(device => !savedTvDevices.some(saved => saved.macAddress === device.macAddress)).map(device => (
                        <option key={`${device.routerId}-${device.macAddress}`} value={device.macAddress}>
                          {device.name} — {device.macAddress}{device.address ? ` · ${device.address}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="hp-tv-help">
                      {tvDevicesLoading
                        ? "Checking the connected devices on your hotspot router…"
                        : tvDevices.length > 0
                         ? "Every device reported by the router is listed with its MAC address. Select one or add a TV manually."
                         : "No devices were reported by the router. Add the TV MAC address manually."}
                    </div>
                    {!tvDevicesLoading && tvDevices.length > 0 && (
                      <div className="hp-tv-device-list" aria-label="Available connected devices">
                        {tvDevices.map(device => (
                          <div className="hp-tv-device-row" key={`device-${device.routerId}-${device.macAddress}`}>
                            <Tv size={14} color="#34d399" />
                            <div>
                              <strong>{device.name}</strong>
                              <span>{device.macAddress}{device.address ? ` · ${device.address}` : ""}{device.routerName ? ` · ${device.routerName}` : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-mac-address">DEVICE MAC ADDRESS</label>
                    <input
                      id="tv-mac-address"
                      className="hp-tv-input"
                      value={tvMacAddress}
                      onChange={e => {
                        const value = e.target.value.toUpperCase();
                        const macAddress = normalizeMacAddress(value);
                        setTvMacAddress(value);
                        setTvDeviceChoice(savedTvDevices.some(device => device.macAddress === macAddress)
                          || tvDevices.some(device => device.macAddress === macAddress)
                          ? macAddress
                          : "");
                        setRememberTvDevice(savedTvDevices.some(device => device.macAddress === macAddress));
                      }}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      inputMode="text"
                      autoCapitalize="characters"
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-device-name">DEVICE NAME</label>
                    <input
                      id="tv-device-name"
                      className="hp-tv-input"
                      value={tvDeviceName}
                      onChange={e => setTvDeviceName(e.target.value)}
                      placeholder="e.g. Living Room TV"
                      maxLength={64}
                      required
                    />
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-save-device">
                      <input
                        type="checkbox"
                        checked={rememberTvDevice}
                        onChange={e => setRememberTvDevice(e.target.checked)}
                      />
                      <span>
                        <strong>Remember this TV on this browser</strong>
                        Saved devices stay on this browser only. You can remove them at any time.
                      </span>
                    </label>
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-package">PACKAGE TO PURCHASE</label>
                    <select
                      id="tv-package"
                      className="hp-tv-select"
                      value={tvPlanId}
                      onChange={e => setTvPlanId(e.target.value)}
                      required
                    >
                      <option value="" disabled>Choose a package</option>
                      {plans.map(plan => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} — {getCurrencySymbol()} {plan.price} · {formatValidity(plan)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="hp-tv-field">
                    <label className="hp-tv-label" htmlFor="tv-phone">PHONE NUMBER</label>
                    <input
                      id="tv-phone"
                      className="hp-tv-input"
                      type="tel"
                      value={tvPhone}
                      onChange={e => setTvPhone(e.target.value)}
                      placeholder="07XX XXX XXX or 01XX XXX XXX"
                      inputMode="tel"
                      required
                    />
                    <div className="hp-tv-help">The M-Pesa payment prompt will be sent to this number.</div>
                  </div>

                  {tvDialogError && (
                    <div className="hp-error" role="alert">
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {tvDialogError}
                    </div>
                  )}

                  <button
                    type="button"
                    className="hp-btn hp-tv-reconnect"
                    onClick={() => {
                      setTvDialogOpen(false);
                      void openTvTroubleshooting(tvMacAddress);
                    }}
                  >
                    <Wifi size={15} /> Already paid? Reconnect TV
                  </button>

                  <div className="hp-tv-actions">
                    <button type="button" className="hp-btn hp-tv-cancel" onClick={() => setTvDialogOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="hp-btn hp-btn-mpesa" disabled={payLoading || plansLoading}>
                      {payLoading ? (
                        <><Loader2 size={16} style={{ animation: "spin 1.5s linear infinite" }} /> Starting…</>
                      ) : (
                        <><Tv size={16} /> Bind &amp; Pay</>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {portalCards.deviceIdentity && (
            <div className="hp-device-identity" style={{ padding: "0 0 16px", textAlign: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 8, background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", fontSize: 12 }}>
                Your MAC address:
                <strong className="hp-device-identity-value" style={{ color: "rgba(255,255,255,0.78)", fontFamily: "monospace", fontWeight: 700 }}>
                  {deviceMacAddress || "Resolved by router"}
                </strong>
              </span>
            </div>
          )}
          {loyaltyCardSettings.position === "bottom" && loyaltyBalanceCard}
          {portalCards.footer && (
            <div className="hp-footer">
              {new Date().getFullYear()} {portalDisplayName}
            </div>
          )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
